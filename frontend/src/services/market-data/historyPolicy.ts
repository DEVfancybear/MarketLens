import type { Timeframe } from "@/types";

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
  "1W": 260,
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
