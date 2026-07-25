import { alertArmingRevision } from "../services/alertConditions";
import {
  sanitizeTechnicalAlertEvidence,
  technicalTargetSignature,
} from "../services/dynamicAlertTargets";
import { normalizeAlertTimeZone } from "../services/notifications/alertMessage";
import { resolveStoredDeliveryToken } from "../services/notifications/pushSyncPolicy";
import { sanitizePushAlertForStorage } from "../services/pushAlertSanitizer";
import type {
  PendingPushAlertDelivery,
  PendingPushAlertTrigger,
  PushAlertSyncRequest,
  PushDeviceRecord,
  ServerPushAlert,
} from "../types/pushAlerts";
import { shouldRetainPushAlertState } from "./pushAlertDeliveryPolicy";
import {
  mergeEvaluatorState,
  type EvaluatorStatePatch,
} from "./pushAlertStateMerge";

const WORKER_TIMEOUT_MS = 10_000;
const MAX_WRITE_ATTEMPTS = 3;

interface PushStoreRequestOptions {
  signal?: AbortSignal;
}

export class PushDeviceOwnershipError extends Error {
  constructor() {
    super("push device belongs to another user");
    this.name = "PushDeviceOwnershipError";
  }
}

class PushDeviceConflictError extends Error {
  constructor() {
    super("push device changed concurrently");
    this.name = "PushDeviceConflictError";
  }
}

function backendBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:8080"
  ).replace(/\/+$/, "");
}

async function workerRequest<T>(
  path: string,
  init: {
    method?: "GET" | "POST";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const secret = process.env.PUSH_WORKER_SECRET?.trim();
  if (!secret) throw new Error("PUSH_WORKER_SECRET is not configured.");
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abortFromCaller();
  else init.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${backendBase()}/api/v1/push/worker-devices${path}`,
      {
        method: init.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          "x-push-worker-secret": secret,
        },
        ...(init.body === undefined
          ? {}
          : { body: JSON.stringify(init.body) }),
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (response.status === 409) throw new PushDeviceConflictError();
    if (!response.ok) {
      throw new Error(`PostgreSQL push store failed (${response.status}).`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abortFromCaller);
  }
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function normalizePriceMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [rawSymbol, rawPrice] of Object.entries(value)) {
    const symbol = rawSymbol.trim().toUpperCase();
    const price = Number(rawPrice);
    if (symbol && Number.isFinite(price) && price > 0) result[symbol] = price;
  }
  return result;
}

function sanitizePendingTrigger(
  value: unknown,
): PendingPushAlertTrigger | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Partial<PendingPushAlertTrigger>;
  const triggerPrice = finitePositiveNumber(item.triggerPrice);
  const targetPrice = finitePositiveNumber(item.targetPrice);
  const triggeredAt = finitePositiveNumber(item.triggeredAt);
  const triggerEvidence = sanitizeTechnicalAlertEvidence(item.triggerEvidence);
  if (!triggerPrice || !targetPrice || !triggeredAt || !triggerEvidence) {
    return undefined;
  }
  return {
    triggerPrice,
    targetPrice,
    triggeredAt,
    triggerEvidence,
  };
}

function sanitizePendingDelivery(
  value: unknown,
): PendingPushAlertDelivery | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Partial<PendingPushAlertDelivery>;
  const alert = sanitizePushAlertForStorage(item.alert);
  const candidate = sanitizePendingTrigger(item.candidate);
  if (
    typeof item.eventId !== "string" ||
    !item.eventId.trim() ||
    !alert ||
    !candidate ||
    typeof item.push !== "boolean" ||
    typeof item.telegram !== "boolean" ||
    typeof item.discord !== "boolean"
  ) {
    return undefined;
  }
  return {
    eventId: item.eventId.trim(),
    alert,
    candidate,
    notificationTimeZone: normalizeAlertTimeZone(item.notificationTimeZone),
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
    const triggerEvidence = sanitizeTechnicalAlertEvidence(
      input.triggerEvidence,
    );
    if (input.triggerEvidence !== undefined && !triggerEvidence) continue;
    if (triggerEvidence) state.triggerEvidence = triggerEvidence;
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

function decodePushDevice(value: unknown): PushDeviceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Backend returned an invalid push device.");
  }
  const data = value as Record<string, unknown>;
  const token = typeof data.token === "string" ? data.token.trim() : "";
  const version = finitePositiveNumber(data.version);
  if (!token || !version) {
    throw new Error("Backend returned an invalid push device identity.");
  }
  const alerts = Array.isArray(data.alerts)
    ? data.alerts
        .map(sanitizePushAlertForStorage)
        .filter((alert): alert is ServerPushAlert => Boolean(alert))
    : [];
  return {
    token,
    userId: typeof data.userId === "string" ? data.userId : undefined,
    deliveryToken:
      typeof data.deliveryToken === "string" && data.deliveryToken.trim()
        ? data.deliveryToken.trim()
        : undefined,
    notificationTimeZone: normalizeAlertTimeZone(data.notificationTimeZone),
    alerts,
    settingsPush: Boolean(data.settingsPush),
    settingsTelegram: Boolean(data.settingsTelegram),
    settingsDiscord: Boolean(data.settingsDiscord),
    lastPrices: normalizePriceMap(data.lastPrices),
    alertState: sanitizeAlertState(data.alertState),
    createdAt: finitePositiveNumber(data.createdAt) ?? Date.now(),
    updatedAt: finitePositiveNumber(data.updatedAt) ?? Date.now(),
    version,
  };
}

function alertStateSignature(alert: ServerPushAlert): string {
  return `${alertArmingRevision(
    alert.condition,
    alert.symbol,
    alert.price,
    alert.recurring,
    alert.armingRevision,
  )}:${technicalTargetSignature(alert.technicalTarget)}`;
}

function mergeClientTriggerState(
  alerts: ServerPushAlert[],
  state: PushDeviceRecord["alertState"],
): PushDeviceRecord["alertState"] {
  const next = { ...state };
  for (const alert of alerts) {
    const signature = alertStateSignature(alert);
    const existing = next[alert.id];
    if (
      existing?.signature === signature &&
      existing.canonicalRejectedAt !== undefined
    ) {
      next[alert.id] = {
        ...existing,
        canonicalRejectedAt: undefined,
        canonicalRejectedReason: undefined,
        pendingTrigger: undefined,
      };
    }
    if (
      alert.lastTriggeredAt === undefined ||
      alert.triggerPrice === undefined ||
      (existing?.lastTriggeredAt ?? 0) > alert.lastTriggeredAt ||
      ((existing?.lastTriggeredAt ?? 0) === alert.lastTriggeredAt &&
        existing?.signature === signature)
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
  const ids = new Set(device.alerts.map((alert) => alert.id));
  return {
    ...device,
    alertState: Object.fromEntries(
      Object.entries(device.alertState).filter(([id, state]) =>
        shouldRetainPushAlertState(ids.has(id), state),
      ),
    ),
  };
}

async function ensurePushDevice(
  token: string,
  firebaseUid: string,
  options: PushStoreRequestOptions = {},
): Promise<PushDeviceRecord> {
  try {
    const response = await workerRequest<{ ok: true; device: unknown }>(
      "/ensure",
      { body: { firebaseUid, token }, signal: options.signal },
    );
    return decodePushDevice(response.device);
  } catch (error) {
    if (error instanceof PushDeviceConflictError) {
      throw new PushDeviceOwnershipError();
    }
    throw error;
  }
}

async function putPushDevice(
  device: PushDeviceRecord,
  firebaseUid?: string,
  options: PushStoreRequestOptions = {},
): Promise<PushDeviceRecord> {
  const expectedVersion = finitePositiveNumber(device.version);
  if (!expectedVersion) {
    throw new Error("Push device version is missing.");
  }
  const response = await workerRequest<{ ok: true; device: unknown }>("/put", {
    body: {
      ...(firebaseUid ? { firebaseUid } : {}),
      expectedVersion,
      device,
    },
    signal: options.signal,
  });
  return decodePushDevice(response.device);
}

export async function registerPushDevice(
  token: string,
  userId: string,
  options: PushStoreRequestOptions = {},
): Promise<void> {
  await ensurePushDevice(token, userId, options);
}

export async function unregisterPushDevice(
  token: string,
  userId: string,
  options: PushStoreRequestOptions = {},
): Promise<void> {
  await workerRequest<{ ok: true }>("/delete", {
    body: { firebaseUid: userId, token },
    signal: options.signal,
  });
}

export async function getPushDevice(
  token: string,
  userId?: string,
  options: PushStoreRequestOptions = {},
): Promise<PushDeviceRecord | undefined> {
  const response = await workerRequest<{ ok: true; device: unknown | null }>(
    "/get",
    {
      body: { ...(userId ? { firebaseUid: userId } : {}), token },
      signal: options.signal,
    },
  );
  return response.device ? decodePushDevice(response.device) : undefined;
}

export async function listPushDevices(
  options: PushStoreRequestOptions = {},
): Promise<PushDeviceRecord[]> {
  const response = await workerRequest<{ ok: true; devices: unknown[] }>("", {
    method: "GET",
    signal: options.signal,
  });
  if (!Array.isArray(response.devices)) {
    throw new Error("Backend returned an invalid push device list.");
  }
  return response.devices.map(decodePushDevice);
}

export async function syncPushAlerts(
  request: PushAlertSyncRequest,
  userId: string,
  options: PushStoreRequestOptions = {},
): Promise<{ stored: number }> {
  const shouldStoreAlerts =
    request.settingsPush ||
    Boolean(request.settingsTelegram) ||
    Boolean(request.settingsDiscord);
  const sanitized = shouldStoreAlerts
    ? request.alerts.map(sanitizePushAlertForStorage)
    : [];
  if (sanitized.some((alert) => alert === null)) {
    throw new Error("invalid push alert snapshot");
  }
  const snapshot = sanitized as ServerPushAlert[];
  let current =
    (await getPushDevice(request.token, userId, options)) ??
    (await ensurePushDevice(request.token, userId, options));

  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const now = Date.now();
    const next = pruneState({
      ...current,
      deliveryToken: resolveStoredDeliveryToken(
        request.deliveryToken,
        current.deliveryToken,
      ),
      notificationTimeZone: normalizeAlertTimeZone(
        request.notificationTimeZone ?? current.notificationTimeZone,
      ),
      alerts: snapshot,
      settingsPush: Boolean(request.settingsPush),
      settingsTelegram: Boolean(request.settingsTelegram),
      settingsDiscord: Boolean(request.settingsDiscord),
      alertState: mergeClientTriggerState(snapshot, current.alertState),
      updatedAt: now,
    });
    try {
      await putPushDevice(next, userId, options);
      return { stored: snapshot.length };
    } catch (error) {
      if (!(error instanceof PushDeviceConflictError)) throw error;
      const refreshed = await getPushDevice(request.token, userId, options);
      if (!refreshed) throw new PushDeviceOwnershipError();
      current = refreshed;
    }
  }
  throw new PushDeviceConflictError();
}

export async function updatePushDevice(
  snapshot: PushDeviceRecord,
  patch: EvaluatorStatePatch,
  options: PushStoreRequestOptions = {},
): Promise<void> {
  let current = snapshot;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const merged = mergeEvaluatorState(current, patch);
    try {
      await putPushDevice({
        ...current,
        ...merged,
        updatedAt: Date.now(),
      }, undefined, options);
      return;
    } catch (error) {
      if (!(error instanceof PushDeviceConflictError)) throw error;
      const refreshed = await getPushDevice(current.token, undefined, options);
      if (!refreshed) return;
      current = refreshed;
    }
  }
  throw new PushDeviceConflictError();
}
