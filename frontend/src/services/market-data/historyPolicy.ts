import { TF_SECONDS, type Timeframe } from "../../types";

/** Collapses Strict Mode probes and rapid selection changes before REST starts. */
export const HISTORY_SELECTION_DEBOUNCE_MS = 75;

/**
 * Keep the first paint small and load older bars only when the user pans left.
 * Large MT5 requests are disproportionately expensive on a cold timeframe.
 */
const INITIAL_BARS: Record<Timeframe, number> = {
  "1m": 900,
  "3m": 900,
  "5m": 900,
  "15m": 900,
  "30m": 720,
  "1H": 600,
  "2H": 500,
  "4H": 400,
  "1D": 300,
  "1W": 100,
  "1M": 60,
};

const PAGE_BARS: Record<Timeframe, number> = {
  "1m": 1000,
  "3m": 1000,
  "5m": 1000,
  "15m": 1000,
  "30m": 720,
  "1H": 600,
  "2H": 500,
  "4H": 400,
  "1D": 300,
  "1W": 260,
  "1M": 60,
};

const MT5_REFRESH_MS: Record<Timeframe, number> = {
  "1m": 3_000,
  "3m": 3_000,
  "5m": 3_000,
  "15m": 5_000,
  "30m": 5_000,
  "1H": 15_000,
  "2H": 15_000,
  "4H": 30_000,
  "1D": 60_000,
  "1W": 300_000,
  "1M": 300_000,
};

export function initialHistoryBars(timeframe: Timeframe): number {
  return INITIAL_BARS[timeframe];
}

export function historyPageBars(timeframe: Timeframe): number {
  return PAGE_BARS[timeframe];
}

export function mt5HistoryRefreshMs(timeframe: Timeframe): number {
  return MT5_REFRESH_MS[timeframe];
}

/** Latest MT5 refresh size; stale first paints escalate to the initial window. */
export function mt5RefreshBars(timeframe: Timeframe, fullWindow = false): number {
  if (fullWindow) return initialHistoryBars(timeframe);
  if (timeframe === "1D" || timeframe === "1W" || timeframe === "1M") return 5;
  if (timeframe === "1H" || timeframe === "2H" || timeframe === "4H") return 10;
  return 20;
}

export function mt5ActiveHistoryRequest(
  timeframe: Timeframe,
  fullWindow: boolean,
  backfillPending: boolean,
): { limit: number; refresh: true | undefined } {
  if (backfillPending) {
    return {
      limit: initialHistoryBars(timeframe),
      refresh: undefined,
    };
  }
  return {
    limit: mt5RefreshBars(timeframe, fullWindow),
    refresh: true,
  };
}

/** Maximum bar-open distance still considered adjacent for MT5 tail repair. */
export function mt5TailContinuitySeconds(timeframe: Timeframe): number {
  // Calendar months vary and broker/DST alignment can move the UTC open. Keep
  // this separate from TF_SECONDS so fixed-duration consumers remain unchanged.
  return timeframe === "1M" ? 32 * 86400 : TF_SECONDS[timeframe];
}
