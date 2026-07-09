import { getJson } from "@/services/api/client";
import type { Timeframe } from "@/types";
import type { Options } from "ky";

export interface Mt5Symbol {
  name: string;
  path?: string;
  description?: string;
  visible: boolean;
  digits: number;
  point: number;
  spread: number;
  trade_mode: number;
  currency_base?: string;
  currency_profit?: string;
  currency_margin?: string;
}

export interface Mt5SymbolSnapshot {
  connected: boolean;
  bridgeUrl: string;
  source: string;
  count: number;
  streamSymbols: string[];
  symbols: Mt5Symbol[];
  updatedAt?: string;
  lastError?: string;
}

export interface Mt5Tick {
  type?: string;
  source?: string;
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  time_msc?: number;
}

export interface Mt5TickSnapshot {
  connected: boolean;
  bridgeUrl: string;
  source: string;
  ticks: Mt5Tick[];
  updatedAt?: string;
  lastError?: string;
}

export interface Mt5Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Mt5HistorySnapshot {
  connected: boolean;
  bridgeUrl: string;
  source: string;
  symbol: string;
  timeframe: Timeframe;
  candles: Mt5Candle[];
  updatedAt?: string;
  lastError?: string;
}

export async function getMt5Symbols(): Promise<Mt5SymbolSnapshot> {
  return getJson<Mt5SymbolSnapshot>("mt5/symbols");
}

export async function getMt5Ticks(
  symbols?: string[],
): Promise<Mt5TickSnapshot> {
  const uniqueSymbols = [...new Set((symbols ?? []).map((s) => s.trim()).filter(Boolean))];
  const query =
    uniqueSymbols.length > 0
      ? `?symbols=${encodeURIComponent(uniqueSymbols.join(","))}`
      : "";
  return getJson<Mt5TickSnapshot>(`mt5/ticks${query}`);
}

export async function getMt5History(params: {
  symbol: string;
  timeframe: Timeframe;
  limit?: number;
  before?: number;
  refresh?: boolean;
}, options?: Options): Promise<Mt5HistorySnapshot> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    timeframe: params.timeframe,
    limit: String(params.limit ?? 1500),
  });
  if (params.before) query.set("before", String(params.before));
  if (params.refresh) query.set("refresh", "true");
  return getJson<Mt5HistorySnapshot>(`mt5/history?${query.toString()}`, {
    // MT5 can spend a full retry window warming history for cold symbols or
    // higher timeframes. The Go endpoint has a 70s HTTP budget; keep the browser
    // above that so it does not cancel first and fall back to realtime-only UI.
    timeout: 75_000,
    retry: { limit: 0 },
    ...options,
  });
}
