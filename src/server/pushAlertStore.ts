import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type {
  PushAlertDb,
  PushAlertSyncRequest,
  PushDeviceRecord,
  ServerPushAlert,
} from "@/types/pushAlerts";

const DB_VERSION = 1;
const STORE_DIR = ".data";
const STORE_FILE = `${STORE_DIR}/push-alerts.json`;

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
  return {
    id: String(alert.id),
    symbol: String(alert.symbol).toUpperCase(),
    condition: alert.condition,
    price: alert.price,
    note: alert.note ? String(alert.note).slice(0, 240) : undefined,
    recurring: Boolean(alert.recurring),
    updatedAt: Number.isFinite(alert.updatedAt) ? alert.updatedAt : Date.now(),
  };
}

function pruneState(device: PushDeviceRecord): PushDeviceRecord {
  const ids = new Set(device.alerts.map((a) => a.id));
  const alertState = Object.fromEntries(
    Object.entries(device.alertState).filter(([id]) => ids.has(id)),
  );
  return { ...device, alertState };
}

export async function registerPushDevice(token: string): Promise<void> {
  const db = await readDb();
  const now = Date.now();
  const existing = db.devices[token];
  db.devices[token] = {
    token,
    alerts: existing?.alerts ?? [],
    settingsPush: existing?.settingsPush ?? false,
    lastPrices: existing?.lastPrices ?? {},
    alertState: existing?.alertState ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeDb(db);
}

export async function unregisterPushDevice(token: string): Promise<void> {
  const db = await readDb();
  delete db.devices[token];
  await writeDb(db);
}

export async function syncPushAlerts(
  request: PushAlertSyncRequest,
): Promise<{ stored: number }> {
  const db = await readDb();
  const now = Date.now();
  const existing = db.devices[request.token];
  const alerts = request.settingsPush
    ? request.alerts
        .map(sanitizeAlert)
        .filter((alert): alert is ServerPushAlert => Boolean(alert))
    : [];

  const device: PushDeviceRecord = pruneState({
    token: request.token,
    alerts,
    settingsPush: Boolean(request.settingsPush),
    lastPrices: existing?.lastPrices ?? {},
    alertState: existing?.alertState ?? {},
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });

  db.devices[request.token] = device;
  await writeDb(db);
  return { stored: device.alerts.length };
}

export async function listPushDevices(): Promise<PushDeviceRecord[]> {
  const db = await readDb();
  return Object.values(db.devices);
}

export async function updatePushDevice(
  token: string,
  patch: Pick<PushDeviceRecord, "lastPrices" | "alertState">,
): Promise<void> {
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
