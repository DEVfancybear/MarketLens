import { deleteJson, getJson, postJson, putJson } from "../client";
import type { AnalyticsReport } from "@/services/analyticsEngine";
import type { Position } from "@/types";

export interface SimAccount {
  id: string;
  name: string;
  startingEquity: number;
  equity: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendSimPosition extends Omit<Position, "id" | "openTime" | "closeTime"> {
  id: string;
  clientId: string;
  openTime?: string;
  closeTime?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SimPositionWrite extends Omit<Position, "id" | "openTime" | "closeTime"> {
  clientId: string;
  openTime?: string;
  closeTime?: string;
}

export const listSimAccounts = () => getJson<SimAccount[]>("sim/accounts");
export const createSimAccount = (input: { name: string; startingEquity: number; currency: string }) =>
  postJson<SimAccount>("sim/accounts", input);
export const updateSimAccount = (id: string, input: { name: string; startingEquity: number; currency: string }) =>
  putJson<SimAccount>(`sim/accounts/${encodeURIComponent(id)}`, input);
export async function deleteSimAccount(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`sim/accounts/${encodeURIComponent(id)}`);
}
export const resetSimAccount = (id: string) =>
  postJson<SimAccount>(`sim/accounts/${encodeURIComponent(id)}/reset`);
export const listSimPositions = (accountId: string, status?: Position["status"]) =>
  getJson<BackendSimPosition[]>(`sim/accounts/${encodeURIComponent(accountId)}/positions${status ? `?status=${status}` : ""}`);
export const upsertSimPosition = (accountId: string, input: SimPositionWrite) =>
  postJson<BackendSimPosition>(`sim/accounts/${encodeURIComponent(accountId)}/orders`, input);
export async function getSimAnalytics(accountId: string): Promise<AnalyticsReport> {
  const report = await getJson<AnalyticsReport>(`sim/accounts/${encodeURIComponent(accountId)}/analytics`);
  if (report.summary.profitFactor > 1e300) report.summary.profitFactor = Infinity;
  return report;
}

export function positionToWrite(position: Position): SimPositionWrite {
  const toISO = (seconds: number | undefined) =>
    seconds == null ? undefined : new Date(seconds * 1000).toISOString();
  const { id, openTime, closeTime, ...snapshot } = position;
  return {
    ...snapshot,
    clientId: id,
    openTime: toISO(openTime),
    closeTime: toISO(closeTime),
  };
}

export function positionFromBackend(position: BackendSimPosition): Position {
  const toSeconds = (value: string | undefined) =>
    value == null ? undefined : Math.floor(Date.parse(value) / 1000);
  const { id, clientId, openTime, closeTime, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshot } = position;
  return {
    ...snapshot,
    id: clientId || id,
    openTime: toSeconds(openTime) ?? 0,
    closeTime: toSeconds(closeTime),
  };
}
