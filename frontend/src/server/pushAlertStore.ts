import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { firebaseAdminConfigured, getFirebaseFirestore } from "./firebaseAdmin";
import { resolveStoredDeliveryToken } from "@/services/notifications/pushSyncPolicy";
import { shouldRetainPushAlertState } from "./pushAlertDeliveryPolicy";
import type {
  PushAlertDb,
  PushAlertSyncRequest,
  PushDeviceRecord,
  ServerPushAlert,
} from "@/types/pushAlerts";
import { alertArmingRevision } from "@/services/alertConditions";
import { technicalTargetSignature } from "@/services/dynamicAlertTargets";
import { sanitizePushAlertForStorage } from "@/services/pushAlertSanitizer";
import { normalizeAlertTimeZone } from "@/services/notifications/alertMessage";

const DB_VERSION = 1;
const STORE_DIR = ".data";
const STORE_FILE = `${STORE_DIR}/push-alerts.json`;
const COLLECTION = "pushAlertDevices";

function emptyDb(): PushAlertDb {
  return { version: DB_VERSION, devices: {} };
}

async function readDb(): Promise<PushAlertDb> {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as PushAlertDb;
    if (parsed.version !== DB_VERSION || !parsed.devices) return emptyDb();
    for (const device of Object.values(parsed.devices)) {
      device.alerts = Array.isArray(device.alerts)
        ? device.alerts
            .map(sanitizePushAlertForStorage)
            .filter((alert): alert is ServerPushAlert => Boolean(alert))
        : [];
    }
    return parsed;
  } catch {
    return emptyDb();
  }
}

async function writeDb(db: PushAlertDb): Promise<void> {
  const file = STORE_FILE;
  await mkdir(STORE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
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
    deliveryToken: typeof data.deliveryToken === "string" ? data.deliveryToken : undefined,
    notificationTimeZone: normalizeAlertTimeZone(data.notificationTimeZone),
    alerts,
    settingsPush: Boolean(data.settingsPush),
    settingsTelegram: Boolean(data.settingsTelegram),
    settingsDiscord: Boolean(data.settingsDiscord),
    lastPrices:
      data.lastPrices && typeof data.lastPrices === "object"
        ? (data.lastPrices as Record<string, number>)
        : {},
    alertState:
      data.alertState && typeof data.alertState === "object"
        ? (data.alertState as PushDeviceRecord["alertState"])
        : {},
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

async function setFirestoreDevice(device: PushDeviceRecord): Promise<void> {
  await getFirebaseFirestore()
    .collection(COLLECTION)
    .doc(tokenDocId(device.token))
    .set(stripUndefined(device));
}

export async function registerPushDevice(token: string): Promise<void> {
  if (firestoreEnabled()) {
    const now = Date.now();
    const existing = await getFirestoreDevice(token);
    await setFirestoreDevice({
      token,
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
    });
    return;
  }

  const db = await readDb();
  const now = Date.now();
  const existing = db.devices[token];
  db.devices[token] = {
    token,
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

export async function unregisterPushDevice(token: string): Promise<void> {
  if (firestoreEnabled()) {
    await getFirebaseFirestore()
      .collection(COLLECTION)
      .doc(tokenDocId(token))
      .delete();
    return;
  }

  const db = await readDb();
  delete db.devices[token];
  await writeDb(db);
}

export async function syncPushAlerts(
  request: PushAlertSyncRequest,
): Promise<{ stored: number }> {
  if (firestoreEnabled()) {
    const now = Date.now();
    const existing = await getFirestoreDevice(request.token);
    const shouldStoreAlerts =
      request.settingsPush ||
      Boolean(request.settingsTelegram) ||
      Boolean(request.settingsDiscord);
    const alerts = shouldStoreAlerts
      ? request.alerts
          .map(sanitizePushAlertForStorage)
          .filter((alert): alert is ServerPushAlert => Boolean(alert))
      : [];
    const device = pruneState({
      token: request.token,
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
    await setFirestoreDevice(device);
    return { stored: device.alerts.length };
  }

  const db = await readDb();
  const now = Date.now();
  const existing = db.devices[request.token];
  const shouldStoreAlerts =
    request.settingsPush ||
    Boolean(request.settingsTelegram) ||
    Boolean(request.settingsDiscord);
  const alerts = shouldStoreAlerts
    ? request.alerts
        .map(sanitizePushAlertForStorage)
        .filter((alert): alert is ServerPushAlert => Boolean(alert))
    : [];

  const device: PushDeviceRecord = pruneState({
    token: request.token,
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

export async function getPushDevice(
  token: string,
): Promise<PushDeviceRecord | undefined> {
  if (firestoreEnabled()) {
    return getFirestoreDevice(token);
  }

  const db = await readDb();
  return db.devices[token];
}

export async function listPushDevices(): Promise<PushDeviceRecord[]> {
  if (firestoreEnabled()) {
    const snap = await getFirebaseFirestore().collection(COLLECTION).get();
    return snap.docs.map((doc) => fromFirestore(doc.data()));
  }

  const db = await readDb();
  return Object.values(db.devices);
}

export async function updatePushDevice(
  token: string,
  patch: Pick<PushDeviceRecord, "lastPrices" | "alertState">,
): Promise<void> {
  if (firestoreEnabled()) {
    const existing = await getFirestoreDevice(token);
    if (!existing) return;
    await setFirestoreDevice({
      ...existing,
      lastPrices: patch.lastPrices,
      alertState: patch.alertState,
      updatedAt: Date.now(),
    });
    return;
  }

  const db = await readDb();
  const existing = db.devices[token];
  if (!existing) return;
  db.devices[token] = {
    ...existing,
    lastPrices: patch.lastPrices,
    alertState: patch.alertState,
    updatedAt: Date.now(),
  };
  await writeDb(db);
}
