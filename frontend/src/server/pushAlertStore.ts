import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { firebaseAdminConfigured, getFirebaseFirestore } from "./firebaseAdmin";
import type {
  PushAlertDb,
  PushAlertSyncRequest,
  PushDeviceRecord,
  ServerPushAlert,
} from "@/types/pushAlerts";
import { alertArmingRevision } from "@/services/alertConditions";

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

function sanitizeAlert(alert: ServerPushAlert): ServerPushAlert | null {
  if (!alert.id || !alert.symbol) return null;
  if (!Number.isFinite(alert.price) || alert.price <= 0) return null;
  if (
    alert.condition !== "above" &&
    alert.condition !== "below" &&
    alert.condition !== "crossUp" &&
    alert.condition !== "crossDown"
  ) {
    return null;
  }
  const sanitized: ServerPushAlert = {
    id: String(alert.id),
    symbol: String(alert.symbol).toUpperCase(),
    condition: alert.condition,
    price: alert.price,
    recurring: Boolean(alert.recurring),
    updatedAt: Number.isFinite(alert.updatedAt) ? alert.updatedAt : Date.now(),
    push: Boolean(alert.push),
    telegram: Boolean(alert.telegram),
    discord: Boolean(alert.discord),
  };
  if (alert.note) sanitized.note = String(alert.note).slice(0, 240);
  if (Number.isFinite(alert.lastTriggeredAt)) {
    sanitized.lastTriggeredAt = alert.lastTriggeredAt;
  }
  if (Number.isFinite(alert.triggerPrice)) {
    sanitized.triggerPrice = alert.triggerPrice;
  }
  return sanitized;
}

function mergeClientTriggerState(
  alerts: ServerPushAlert[],
  state: PushDeviceRecord["alertState"],
): PushDeviceRecord["alertState"] {
  const next = { ...state };
  for (const alert of alerts) {
    const signature = alertArmingRevision(
      alert.condition,
      alert.symbol,
      alert.price,
      alert.recurring,
      alert.updatedAt,
    );
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
      oneTimeFired: !alert.recurring,
      triggerPrice: alert.triggerPrice,
    };
  }
  return next;
}

function pruneState(device: PushDeviceRecord): PushDeviceRecord {
  const ids = new Set(device.alerts.map((a) => a.id));
  const alertState = Object.fromEntries(
    Object.entries(device.alertState).filter(([id]) => ids.has(id)),
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
  return {
    token: String(data.token),
    deliveryToken: typeof data.deliveryToken === "string" ? data.deliveryToken : undefined,
    alerts: Array.isArray(data.alerts) ? (data.alerts as ServerPushAlert[]) : [],
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
          .map(sanitizeAlert)
          .filter((alert): alert is ServerPushAlert => Boolean(alert))
      : [];
    const device = pruneState({
      token: request.token,
      deliveryToken: request.deliveryToken,
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
        .map(sanitizeAlert)
        .filter((alert): alert is ServerPushAlert => Boolean(alert))
    : [];

  const device: PushDeviceRecord = pruneState({
    token: request.token,
    deliveryToken: request.deliveryToken,
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
