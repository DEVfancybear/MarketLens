import {
  deleteJson,
  getJson,
  patchJson,
  postJson,
} from "../client";
import type {
  Alert,
  AlertCondition,
  AlertHistoryEntry,
} from "../../../store/alertStore";
import type { DrawingAlertSnapshot } from "../../../components/chart/drawing/alerts/drawingAlertCapabilities";
import type {
  TechnicalAlertEvidence,
  TechnicalAlertTarget,
} from "../../../types/technicalAlerts";
import {
  sanitizeTechnicalAlertEvidence,
  sanitizeTechnicalAlertTarget,
} from "../../dynamicAlertTargets";

export interface BackendAlertChannels {
  sound: boolean;
  browser: boolean;
  push: boolean;
  telegram: boolean;
  discord: boolean;
}

export interface BackendAlert {
  id: string;
  clientId?: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  note?: string;
  status: "active" | "triggered" | "expired";
  enabled: boolean;
  locked: boolean;
  recurring: boolean;
  channels: BackendAlertChannels;
  triggerPrice?: number;
  triggeredAt?: string;
  expiredAt?: string;
  createdAt: string;
  updatedAt: string;
  source?: DrawingAlertSnapshot;
  technicalTarget?: TechnicalAlertTarget;
  armingRevision?: number;
}

export interface BackendAlertEvent {
  id: string;
  alertId: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  triggerPrice: number;
  triggeredAt: string;
  delivered: boolean;
  armingRevision?: number;
  evidence?: TechnicalAlertEvidence;
}

export interface BackendAlertSnapshot {
  alerts: BackendAlert[];
  triggeredAlerts: BackendAlert[];
  expiredAlerts?: BackendAlert[];
  history: BackendAlertEvent[];
}

export interface BackendAlertCreate {
  clientId: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  note?: string;
  recurring: boolean;
  enabled: boolean;
  locked: boolean;
  channels: BackendAlertChannels;
  source?: DrawingAlertSnapshot;
  technicalTarget?: TechnicalAlertTarget;
  armingRevision: number;
}

export interface BackendAlertPatch {
  symbol?: string;
  condition?: AlertCondition;
  price?: number;
  note?: string;
  status?: "active" | "expired";
  enabled?: boolean;
  locked?: boolean;
  recurring?: boolean;
  channels?: Partial<BackendAlertChannels>;
  technicalTarget?: TechnicalAlertTarget;
  armingRevision?: number;
}

export interface BackendTriggerResponse {
  alert?: BackendAlert;
  event: BackendAlertEvent;
  alreadyTriggered?: boolean;
}

export interface BackendPushToken {
  id: string;
  fcmToken: string;
  platform: "web" | "android" | "ios";
  permission: NotificationPermission;
  createdAt: string;
  lastSeenAt: string;
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function epochSeconds(value: string): number {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis / 1000 : Date.now() / 1000;
}

export function backendAlertToLocal(row: BackendAlert): Alert {
  const technicalTarget = sanitizeTechnicalAlertTarget(row.technicalTarget);
  if (row.technicalTarget !== undefined && !technicalTarget) {
    throw new Error(`Backend alert ${row.clientId || row.id} has an invalid technical target.`);
  }
  return {
    id: row.clientId || row.id,
    symbol: row.symbol,
    condition: row.condition,
    price: row.price,
    status: row.status,
    enabled: row.enabled,
    locked: row.locked,
    createdAt: epochSeconds(row.createdAt),
    updatedAt: epochSeconds(row.updatedAt),
    triggeredAt: row.triggeredAt
      ? epochSeconds(row.triggeredAt)
      : undefined,
    expiredAt: row.expiredAt
      ? epochSeconds(row.expiredAt)
      : row.status === "expired"
        ? epochSeconds(row.updatedAt)
        : undefined,
    triggerPrice: row.triggerPrice,
    note: row.note || undefined,
    recurring: row.recurring,
    sound: row.channels.sound,
    browser: row.channels.browser,
    push: row.channels.push,
    telegram: row.channels.telegram,
    discord: row.channels.discord,
    source: row.source,
    technicalTarget,
    armingRevision:
      typeof row.armingRevision === "number" && Number.isFinite(row.armingRevision)
        ? Math.max(1, Math.trunc(row.armingRevision))
        : Math.max(1, Math.trunc(epochSeconds(row.updatedAt))),
  };
}

export function backendAlertEventToLocal(
  row: BackendAlertEvent,
): AlertHistoryEntry {
  const evidence = sanitizeTechnicalAlertEvidence(row.evidence);
  return {
    id: row.id,
    alertId: row.alertId,
    symbol: row.symbol,
    condition: row.condition,
    targetPrice: row.targetPrice,
    triggerPrice: row.triggerPrice,
    triggerTime: epochSeconds(row.triggeredAt),
    ...(evidence ? { evidence } : {}),
  };
}

function channels(alert: Alert): BackendAlertChannels {
  return {
    sound: alert.sound,
    browser: alert.browser,
    push: alert.push,
    telegram: alert.telegram,
    discord: alert.discord,
  };
}

export function localAlertToCreate(alert: Alert): BackendAlertCreate {
  return {
    clientId: alert.id,
    symbol: alert.symbol,
    condition: alert.condition,
    price: alert.price,
    note: alert.note,
    recurring: alert.recurring,
    enabled: alert.enabled,
    locked: alert.locked,
    channels: channels(alert),
    ...(alert.source ? { source: alert.source } : {}),
    ...(alert.technicalTarget ? { technicalTarget: alert.technicalTarget } : {}),
    armingRevision: alert.armingRevision,
  };
}

export function localAlertToPatch(alert: Alert): BackendAlertPatch {
  return {
    symbol: alert.symbol,
    condition: alert.condition,
    price: alert.price,
    note: alert.note ?? "",
    enabled: alert.enabled,
    locked: alert.locked,
    recurring: alert.recurring,
    channels: channels(alert),
    technicalTarget: alert.technicalTarget,
    armingRevision: alert.armingRevision,
  };
}

export async function listAlerts(status?: "active" | "triggered" | "expired"): Promise<BackendAlert[]> {
  const query = status ? `?status=${status}` : "";
  return getJson<BackendAlert[]>(`alerts${query}`);
}

export async function createAlert(payload: BackendAlertCreate): Promise<BackendAlert> {
  return postJson<BackendAlert>("alerts", payload);
}

export async function patchAlert(id: string, payload: BackendAlertPatch): Promise<BackendAlert> {
  return patchJson<BackendAlert>(`alerts/${encodePath(id)}`, payload);
}

export async function deleteAlert(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`alerts/${encodePath(id)}`);
}

export async function triggerAlert(
  id: string,
  triggerPrice: number,
  targetPrice?: number,
  evidence?: TechnicalAlertEvidence,
  armingRevision?: number,
): Promise<BackendTriggerResponse> {
  return postJson<BackendTriggerResponse>(`alerts/${encodePath(id)}/trigger`, {
    triggerPrice,
    ...(targetPrice !== undefined ? { targetPrice } : {}),
    ...(evidence?.previous ? { previous: evidence.previous } : {}),
    current: evidence?.current ?? {
      price: triggerPrice,
      timestamp: Date.now() / 1000,
    },
    ...(armingRevision !== undefined ? { armingRevision } : {}),
  });
}

export async function listAlertEvents(id: string): Promise<BackendAlertEvent[]> {
  return getJson<BackendAlertEvent[]>(`alerts/${encodePath(id)}/events`);
}

export async function listAlertHistory(): Promise<BackendAlertEvent[]> {
  return getJson<BackendAlertEvent[]>("alerts/history");
}

export async function clearAlertHistory(): Promise<void> {
  await deleteJson<{ ok: boolean }>("alerts/history");
}

export async function registerPushToken(payload: {
  fcmToken: string;
  platform?: "web" | "android" | "ios";
  permission: NotificationPermission;
}): Promise<BackendPushToken> {
  return postJson<BackendPushToken>("push/tokens", {
    platform: "web",
    ...payload,
  });
}

export async function deletePushToken(token: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`push/tokens/${encodePath(token)}`);
}
