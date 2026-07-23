import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { firebaseAdminConfigured, getFirebaseFirestore } from "./firebaseAdmin";
import { resolveStoredDeliveryToken } from "@/services/notifications/pushSyncPolicy";
import { shouldRetainPushAlertState } from "./pushAlertDeliveryPolicy";
import type {
  PendingPushAlertDelivery,
  PendingPushAlertTrigger,
  PushAlertDb,
  PushAlertSyncRequest,
  PushDeviceRecord,
  ServerPushAlert,
} from "@/types/pushAlerts";
import { alertArmingRevision } from "@/services/alertConditions";
import {
  sanitizeTechnicalAlertEvidence,
  technicalTargetSignature,
} from "@/services/dynamicAlertTargets";
import { sanitizePushAlertForStorage } from "@/services/pushAlertSanitizer";
import { normalizeAlertTimeZone } from "@/services/notifications/alertMessage";
import {
  mergeEvaluatorState,
  type EvaluatorStatePatch,
} from "./pushAlertStateMerge";

const DB_VERSION = 1;
const STORE_DIR = ".data";
const STORE_FILE = `${STORE_DIR}/push-alerts.json`;
const COLLECTION = "pushAlertDevices";

/**
 * All local-file mutations share one queue. A per-token queue is not enough:
 * the JSON file is one document, so two different tokens can still lose each
 * other's updates when they read and replace the file concurrently.
 */
let mutationQueue: Promise<void> = Promise.resolve();

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.catch(() => undefined).then(operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function emptyDb(): PushAlertDb {
  return { version: DB_VERSION, devices: {} };
}

function normalizePriceMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [rawSymbol, rawPrice] of Object.entries(value)) {
    const symbol = rawSymbol.trim().toUpperCase();
    const price = Number(rawPrice);
    if (symbol && Number.isFinite(price) && price > 0) {
      result[symbol] = price;
    }
  }
  return result;
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function sanitizePendingTrigger(value: unknown): PendingPushAlertTrigger | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Partial<PendingPushAlertTrigger>;
  const triggerPrice = finitePositiveNumber(item.triggerPrice);
  const targetPrice = finitePositiveNumber(item.targetPrice);
  const triggeredAt = finitePositiveNumber(item.triggeredAt);
  const triggerEvidence = sanitizeTechnicalAlertEvidence(item.triggerEvidence);
  if (!triggerPrice || !targetPrice || !triggeredAt || !triggerEvidence) {
    return undefined;
  }
  return { triggerPrice, targetPrice, triggeredAt, triggerEvidence };
}

function sanitizePendingDelivery(
  value: unknown,
): PendingPushAlertDelivery | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Partial<PendingPushAlertDelivery>;
  if (typeof item.eventId !== "string" || !item.eventId.trim()) return undefined;
  const alert = sanitizePushAlertForStorage(item.alert);
  const candidate = sanitizePendingTrigger(item.candidate);
  if (!alert || !candidate) return undefined;
  if (
    typeof item.push !== "boolean" ||
    typeof item.telegram !== "boolean" ||
    typeof item.discord !== "boolean"
  ) {
    return undefined;
  }
  const notificationTimeZone =
    typeof item.notificationTimeZone === "string"
      ? normalizeAlertTimeZone(item.notificationTimeZone)
      : undefined;
  return {
    eventId: item.eventId.trim(),
    alert,
    candidate,
    ...(notificationTimeZone ? { notificationTimeZone } : {}),
    push: item.push,
    telegram: item.telegram,
    discord: item.discord,
  };
}

function sanitizeAlertState(
  value: unknown,
): PushDeviceRecord["alertState"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: PushDeviceRecord["alertState"] = {};
  for (const [id, rawState] of Object.entries(value)) {
    if (
      !id.trim() ||
      !rawState ||
      typeof rawState !== "object" ||
      Array.isArray(rawState)
    ) {
      continue;
    }
    const input = rawState as Partial<PushDeviceRecord["alertState"][string]>;
    if (typeof input.signature !== "string" || !input.signature.trim()) continue;
    const state: PushDeviceRecord["alertState"][string] = {
      signature: input.signature,
    };
    for (const key of [
      "lastTriggeredAt",
      "lastEvaluatedAt",
      "lastMarketTimestamp",
      "triggerPrice",
      "targetPrice",
      "canonicalRejectedAt",
      "expiredAt",
    ] as const) {
      const number = finitePositiveNumber(input[key]);
      if (number !== undefined) state[key] = number;
    }
    if (typeof input.oneTimeFired === "boolean") {
      state.oneTimeFired = input.oneTimeFired;
    }
    const evidence = sanitizeTechnicalAlertEvidence(input.triggerEvidence);
    if (input.triggerEvidence !== undefined && !evidence) continue;
    if (evidence) state.triggerEvidence = evidence;
    const pendingTrigger = sanitizePendingTrigger(input.pendingTrigger);
    if (input.pendingTrigger !== undefined && !pendingTrigger) continue;
    if (pendingTrigger) state.pendingTrigger = pendingTrigger;
    const pendingDelivery = sanitizePendingDelivery(input.pendingDelivery);
    if (input.pendingDelivery !== undefined && !pendingDelivery) continue;
    if (pendingDelivery) state.pendingDelivery = pendingDelivery;
    if (typeof input.canonicalRejectedReason === "string") {
      state.canonicalRejectedReason = input.canonicalRejectedReason
        .trim()
        .slice(0, 500);
    }
    result[id] = state;
  }
  return result;
}

async function readDb(): Promise<PushAlertDb> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as PushAlertDb;
    if (parsed.version !== DB_VERSION || !parsed.devices) return emptyDb();
    for (const [deviceKey, rawDevice] of Object.entries(parsed.devices)) {
      if (
        !rawDevice ||
        typeof rawDevice !== "object" ||
        Array.isArray(rawDevice)
      ) {
        delete parsed.devices[deviceKey];
        continue;
      }
      const device = rawDevice as PushDeviceRecord;
      device.alerts = Array.isArray(device.alerts)
        ? device.alerts
            .map(sanitizePushAlertForStorage)
            .filter((alert): alert is ServerPushAlert => Boolean(alert))
        : [];
      device.lastPrices = normalizePriceMap(device.lastPrices);
      device.alertState = sanitizeAlertState(device.alertState);
    }
    return parsed;
  } catch {
    return emptyDb();
  }
}

async function writeDb(db: PushAlertDb): Promise<void> {
  const file = STORE_FILE;
  await mkdir(STORE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await rename(tmp, file);
}

function mergeClientTriggerState(
  alerts: ServerPushAlert[],
  state: PushDeviceRecord["alertState"],
): PushDeviceRecord["alertState"] {
  const next = { ...state };
  for (const alert of alerts) {
    const signature = `${alertArmingRevision(
      alert.condition,
      alert.symbol,
      alert.price,
      alert.recurring,
      alert.armingRevision,
    )}:${technicalTargetSignature(alert.technicalTarget)}`;
    const existingState = next[alert.id];
    if (
      existingState?.signature === signature &&
      existingState.canonicalRejectedAt !== undefined
    ) {
      // A successful browser sync is the recovery boundary for an updated
      // credential or corrected backend alert. Permit one fresh evaluation.
      next[alert.id] = {
        ...existingState,
        canonicalRejectedAt: undefined,
        canonicalRejectedReason: undefined,
        pendingTrigger: undefined,
      };
    }
    if (
      alert.lastTriggeredAt === undefined ||
      alert.triggerPrice === undefined ||
      (next[alert.id]?.lastTriggeredAt ?? 0) > alert.lastTriggeredAt ||
      ((next[alert.id]?.lastTriggeredAt ?? 0) === alert.lastTriggeredAt &&
        next[alert.id]?.signature === signature)
    ) {
      continue;
    }
    next[alert.id] = {
      signature,
      lastTriggeredAt: alert.lastTriggeredAt,
      lastEvaluatedAt: alert.lastTriggeredAt,
      lastMarketTimestamp: alert.lastTriggeredAt,
      oneTimeFired: !alert.recurring,
      triggerPrice: alert.triggerPrice,
      targetPrice: alert.targetPrice,
      triggerEvidence: alert.triggerEvidence,
    };
  }
  return next;
}

function pruneState(device: PushDeviceRecord): PushDeviceRecord {
  const ids = new Set(device.alerts.map((a) => a.id));
  const alertState = Object.fromEntries(
    Object.entries(device.alertState).filter(
      ([id, state]) => shouldRetainPushAlertState(ids.has(id), state),
    ),
  );
  return { ...device, alertState };
}

function sanitizeAlertSnapshot(
  alerts: readonly ServerPushAlert[],
): ServerPushAlert[] {
  const sanitized = alerts.map(sanitizePushAlertForStorage);
  if (sanitized.some((alert) => alert === null)) {
    throw new Error("invalid push alert snapshot");
  }
  return sanitized as ServerPushAlert[];
}

function firestoreEnabled(): boolean {
  return firebaseAdminConfigured();
}

function tokenDocId(token: string): string {
  return Buffer.from(token).toString("base64url");
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefined) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    ) as T;
  }
  return value;
}

function fromFirestore(data: FirebaseFirestore.DocumentData): PushDeviceRecord {
  const alerts = Array.isArray(data.alerts)
    ? (data.alerts as ServerPushAlert[])
        .map(sanitizePushAlertForStorage)
        .filter((alert): alert is ServerPushAlert => Boolean(alert))
    : [];
  return {
    token: String(data.token),
    userId: typeof data.userId === "string" ? data.userId : undefined,
    deliveryToken: typeof data.deliveryToken === "string" ? data.deliveryToken : undefined,
    notificationTimeZone: normalizeAlertTimeZone(data.notificationTimeZone),
    alerts,
    settingsPush: Boolean(data.settingsPush),
    settingsTelegram: Boolean(data.settingsTelegram),
    settingsDiscord: Boolean(data.settingsDiscord),
    lastPrices:
      normalizePriceMap(data.lastPrices),
    alertState:
      sanitizeAlertState(data.alertState),
    createdAt: Number(data.createdAt ?? Date.now()),
    updatedAt: Number(data.updatedAt ?? Date.now()),
  };
}

async function getFirestoreDevice(
  token: string,
): Promise<PushDeviceRecord | undefined> {
  const snap = await getFirebaseFirestore()
    .collection(COLLECTION)
    .doc(tokenDocId(token))
    .get();
  if (!snap.exists) return undefined;
  return fromFirestore(snap.data() ?? {});
}

function firestoreDeviceRef(token: string) {
  return getFirebaseFirestore()
    .collection(COLLECTION)
    .doc(tokenDocId(token));
}

function assertDeviceOwner(device: PushDeviceRecord | undefined, userId: string): void {
  if (device?.userId && device.userId !== userId) {
    throw new Error("push device belongs to another user");
  }
}

async function registerPushDeviceUnlocked(
  token: string,
  userId: string,
): Promise<void> {
  if (firestoreEnabled()) {
    const firestore = getFirebaseFirestore();
    const ref = firestoreDeviceRef(token);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists
        ? fromFirestore(snapshot.data() ?? {})
        : undefined;
      assertDeviceOwner(existing, userId);
      const now = Date.now();
      transaction.set(
        ref,
        stripUndefined({
          token,
          userId,
          deliveryToken: existing?.deliveryToken,
          notificationTimeZone: normalizeAlertTimeZone(
            existing?.notificationTimeZone,
          ),
          alerts: existing?.alerts ?? [],
          settingsPush: existing?.settingsPush ?? false,
          settingsTelegram: existing?.settingsTelegram ?? false,
          settingsDiscord: existing?.settingsDiscord ?? false,
          lastPrices: existing?.lastPrices ?? {},
          alertState: existing?.alertState ?? {},
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }),
      );
    });
    return;
  }

  const db = await readDb();
  const now = Date.now();
  const existing = db.devices[token];
  assertDeviceOwner(existing, userId);
  db.devices[token] = {
    token,
    userId,
    deliveryToken: existing?.deliveryToken,
    notificationTimeZone: normalizeAlertTimeZone(
      existing?.notificationTimeZone,
    ),
    alerts: existing?.alerts ?? [],
    settingsPush: existing?.settingsPush ?? false,
    settingsTelegram: existing?.settingsTelegram ?? false,
    settingsDiscord: existing?.settingsDiscord ?? false,
    lastPrices: existing?.lastPrices ?? {},
    alertState: existing?.alertState ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeDb(db);
}

export function registerPushDevice(token: string, userId: string): Promise<void> {
  return serializeMutation(() => registerPushDeviceUnlocked(token, userId));
}

async function unregisterPushDeviceUnlocked(
  token: string,
  userId: string,
): Promise<void> {
  if (firestoreEnabled()) {
    const firestore = getFirebaseFirestore();
    const ref = firestoreDeviceRef(token);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists
        ? fromFirestore(snapshot.data() ?? {})
        : undefined;
      assertDeviceOwner(existing, userId);
      transaction.delete(ref);
    });
    return;
  }

  const db = await readDb();
  assertDeviceOwner(db.devices[token], userId);
  delete db.devices[token];
  await writeDb(db);
}

export function unregisterPushDevice(
  token: string,
  userId: string,
): Promise<void> {
  return serializeMutation(() => unregisterPushDeviceUnlocked(token, userId));
}

async function syncPushAlertsUnlocked(
  request: PushAlertSyncRequest,
  userId: string,
): Promise<{ stored: number }> {
  const shouldStoreAlerts =
    request.settingsPush ||
    Boolean(request.settingsTelegram) ||
    Boolean(request.settingsDiscord);
  const alerts = shouldStoreAlerts
    ? sanitizeAlertSnapshot(request.alerts)
    : [];
  if (firestoreEnabled()) {
    const firestore = getFirebaseFirestore();
    const ref = firestoreDeviceRef(request.token);
    const device = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists
        ? fromFirestore(snapshot.data() ?? {})
        : undefined;
      assertDeviceOwner(existing, userId);
      const now = Date.now();
      const next = pruneState({
        token: request.token,
        userId,
        deliveryToken: resolveStoredDeliveryToken(
          request.deliveryToken,
          existing?.deliveryToken,
        ),
        notificationTimeZone: normalizeAlertTimeZone(
          request.notificationTimeZone ?? existing?.notificationTimeZone,
        ),
        alerts,
        settingsPush: Boolean(request.settingsPush),
        settingsTelegram: Boolean(request.settingsTelegram),
        settingsDiscord: Boolean(request.settingsDiscord),
        lastPrices: existing?.lastPrices ?? {},
        alertState: mergeClientTriggerState(alerts, existing?.alertState ?? {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      transaction.set(ref, stripUndefined(next));
      return next;
    });
    return { stored: device.alerts.length };
  }

  const db = await readDb();
  const now = Date.now();
  const existing = db.devices[request.token];
  assertDeviceOwner(existing, userId);

  const device: PushDeviceRecord = pruneState({
    token: request.token,
    userId,
    deliveryToken: resolveStoredDeliveryToken(
      request.deliveryToken,
      existing?.deliveryToken,
    ),
    notificationTimeZone: normalizeAlertTimeZone(
      request.notificationTimeZone ?? existing?.notificationTimeZone,
    ),
    alerts,
    settingsPush: Boolean(request.settingsPush),
    settingsTelegram: Boolean(request.settingsTelegram),
    settingsDiscord: Boolean(request.settingsDiscord),
    lastPrices: existing?.lastPrices ?? {},
    alertState: mergeClientTriggerState(alerts, existing?.alertState ?? {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  db.devices[request.token] = device;
  await writeDb(db);
  return { stored: device.alerts.length };
}

/**
 * A full snapshot replaces the device's alert list. Serialize writes per token
 * so two tabs (or a pagehide flush racing the debounce) cannot read the same
 * old document and let the older snapshot win on disk/Firestore.
 */
export function syncPushAlerts(
  request: PushAlertSyncRequest,
  userId: string,
): Promise<{ stored: number }> {
  return serializeMutation(() => syncPushAlertsUnlocked(request, userId));
}

export async function getPushDevice(
  token: string,
  userId?: string,
): Promise<PushDeviceRecord | undefined> {
  if (firestoreEnabled()) {
    const device = await getFirestoreDevice(token);
    if (userId && device?.userId !== userId) return undefined;
    return device;
  }

  const db = await readDb();
  const device = db.devices[token];
  if (userId && device?.userId !== userId) return undefined;
  return device;
}

export async function listPushDevices(): Promise<PushDeviceRecord[]> {
  if (firestoreEnabled()) {
    const snap = await getFirebaseFirestore().collection(COLLECTION).get();
    return snap.docs.map((doc) => fromFirestore(doc.data()));
  }

  const db = await readDb();
  return Object.values(db.devices);
}

async function updatePushDeviceUnlocked(
  token: string,
  patch: EvaluatorStatePatch,
): Promise<void> {
  if (firestoreEnabled()) {
    const firestore = getFirebaseFirestore();
    const ref = firestoreDeviceRef(token);
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const existing = fromFirestore(snapshot.data() ?? {});
      const merged = mergeEvaluatorState(existing, patch);
      transaction.set(
        ref,
        stripUndefined({
          ...existing,
          lastPrices: merged.lastPrices,
          alertState: merged.alertState,
          updatedAt: Date.now(),
        }),
      );
    });
    return;
  }

  const db = await readDb();
  const existing = db.devices[token];
  if (!existing) return;
  const merged = mergeEvaluatorState(existing, patch);
  db.devices[token] = {
    ...existing,
    lastPrices: merged.lastPrices,
    alertState: merged.alertState,
    updatedAt: Date.now(),
  };
  await writeDb(db);
}

export function updatePushDevice(
  token: string,
  patch: EvaluatorStatePatch,
): Promise<void> {
  return serializeMutation(() => updatePushDeviceUnlocked(token, patch));
}
