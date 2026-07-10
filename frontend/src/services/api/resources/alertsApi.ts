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
  status: "active" | "triggered";
  enabled: boolean;
  locked: boolean;
  recurring: boolean;
  channels: BackendAlertChannels;
  triggerPrice?: number;
  triggeredAt?: string;
  createdAt: string;
  updatedAt: string;
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
}

export interface BackendAlertSnapshot {
  alerts: BackendAlert[];
  triggeredAlerts: BackendAlert[];
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
}

export interface BackendAlertPatch {
  symbol?: string;
  condition?: AlertCondition;
  price?: number;
  note?: string;
  status?: "active";
  enabled?: boolean;
  locked?: boolean;
  recurring?: boolean;
  channels?: Partial<BackendAlertChannels>;
}

export interface BackendTriggerResponse {
  alert: BackendAlert;
  event: BackendAlertEvent;
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
    triggerPrice: row.triggerPrice,
    note: row.note || undefined,
    recurring: row.recurring,
    sound: row.channels.sound,
    browser: row.channels.browser,
    push: row.channels.push,
    telegram: row.channels.telegram,
    discord: row.channels.discord,
  };
}

export function backendAlertEventToLocal(
  row: BackendAlertEvent,
): AlertHistoryEntry {
  return {
    id: row.id,
    alertId: row.alertId,
    symbol: row.symbol,
    condition: row.condition,
    targetPrice: row.targetPrice,
    triggerPrice: row.triggerPrice,
    triggerTime: epochSeconds(row.triggeredAt),
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
  };
}

export async function listAlerts(status?: "active" | "triggered"): Promise<BackendAlert[]> {
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

export async function triggerAlert(id: string, triggerPrice: number): Promise<BackendTriggerResponse> {
  return postJson<BackendTriggerResponse>(`alerts/${encodePath(id)}/trigger`, {
    triggerPrice,
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
