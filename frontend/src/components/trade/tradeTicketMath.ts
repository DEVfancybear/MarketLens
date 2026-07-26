import type { RiskMetrics } from "@/types";

export const EMPTY_RISK_METRICS: RiskMetrics = {
  positionSize: 0,
  riskPct: 0,
  riskAmount: 0,
  rewardAmount: 0,
  riskReward: 0,
};

/**
 * Trade ticket inputs can be prefilled with display-formatted prices such as
 * `62,751.61`. Native `Number()` rejects thousands separators, so every ticket
 * parser must pass through this helper before sending values to risk/order
 * math. Invalid drafts intentionally return `undefined` instead of `NaN`.
 */
export function parseTicketNumber(value: string): number | undefined {
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return undefined;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function formatTicketSize(value: number, precision = 4): string {
  return Number.isFinite(value) ? value.toFixed(precision) : "-";
}

export function formatTicketRatio(value: number): string {
  return Number.isFinite(value) && value > 0 ? value.toFixed(2) : "-";
}

export type TicketLotMode = "auto" | "manual";

export function ticketLotOverride(
  mode: TicketLotMode,
  value: string,
): number | undefined {
  return mode === "manual" ? parseTicketNumber(value) : undefined;
}
