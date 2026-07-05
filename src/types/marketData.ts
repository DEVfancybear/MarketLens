/**
 * Unified market-data models (Phase 1, Step 2).
 *
 * Every data provider (Binance, TwelveData, …) normalizes its native payloads
 * into THESE types. Nothing downstream (store, hooks, chart, watchlist) should
 * ever see a provider-specific shape.
 *
 * `Timeframe` is intentionally single-sourced from `./market` (it already
 * existed app-wide) and re-exported here so this module is the canonical
 * market-data type surface without creating a second, drifting definition.
 */
import type { Timeframe } from "./market";

export type { Timeframe } from "./market";

/** Data origin. Each provider maps its native ids/payloads into the unified models. */
export type MarketProvider = "binance" | "twelvedata" | "oanda" | "mock";

/** Asset class — drives provider routing and formatting. */
export type AssetClass =
  | "crypto"
  | "forex"
  | "metal"
  | "index"
  | "stock"
  | "commodity";

/** WebSocket / feed lifecycle state. */
export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/** Per-provider connection detail (for the status badge + reconnect logic). */
export interface ConnectionState {
  provider: MarketProvider;
  status: ConnectionStatus;
  /** Epoch ms of the last status change. */
  since: number;
  /** Consecutive reconnect attempts (resets on a clean connect). */
  retries: number;
  lastError?: string;
}

/**
 * Unified symbol descriptor. Providers translate to/from `providerSymbol`
 * (e.g. Binance wants lowercase `btcusdt` on the WS, uppercase on REST).
 */
export interface MarketSymbol {
  /** Canonical app-wide id, e.g. "BTCUSDT", "XAUUSD". */
  id: string;
  /** Human label, e.g. "Bitcoin / TetherUS". */
  name: string;
  provider: MarketProvider;
  assetClass: AssetClass;
  /** Display exchange, e.g. "BINANCE", "OANDA". */
  exchange: string;
  /** Base / quote currencies when applicable (BTC / USDT). */
  base?: string;
  quote?: string;
  /** Decimal places for price display. */
  pricePrecision: number;
  /** Minimum price increment. */
  tickSize: number;
  /** Native id on the provider (used to build subscriptions / REST calls). */
  providerSymbol: string;
  /** Whether realtime streaming is available. */
  streamable?: boolean;
}

/** Unified OHLCV candle. `time` is UNIX **seconds** at bar open. */
export interface MarketCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * `false` while the bar is still forming (the live/last candle), `true` once
   * the provider marks it closed. Undefined for historical bars (treated closed).
   */
  closed?: boolean;
}

/**
 * Unified ticker / top-of-book snapshot.
 * Optional fields are populated only when the feed provides them.
 */
export interface MarketQuote {
  symbol: string;
  last: number;
  /** 24h (or session) change, absolute and percent. */
  change: number;
  changePct: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  volume: number;
  bid?: number;
  ask?: number;
  /** Epoch ms of this update. */
  timestamp: number;
}

/** Streaming channels a provider may expose. */
export type MarketChannel = "ticker" | "kline" | "miniTicker";

/** A single symbol subscription. One socket multiplexes many of these. */
export interface MarketSubscription {
  symbol: string;
  channels: MarketChannel[];
  /** Required when `channels` includes `'kline'`. */
  timeframe?: Timeframe;
}

/** Stable key for a subscription, `symbol` or `symbol:timeframe`. */
export type SubscriptionKey = string;

/**
 * Normalized event flowing provider → MarketDataService → marketDataStore.
 * A discriminated union so the service/store can switch exhaustively.
 */
export type MarketDataEvent =
  | {
      type: "quote";
      provider: MarketProvider;
      symbol: string;
      quote: MarketQuote;
    }
  | {
      type: "candle";
      provider: MarketProvider;
      symbol: string;
      timeframe: Timeframe;
      candle: MarketCandle;
    }
  | {
      type: "status";
      provider: MarketProvider;
      status: ConnectionStatus;
      error?: string;
    };

/** Listener used by the service layer to fan events out to the store. */
export type MarketDataListener = (event: MarketDataEvent) => void;

/** Historical-load request shape (used by HistoricalDataService in Step 7). */
export interface HistoryRequest {
  symbol: string;
  timeframe: Timeframe;
  /** Number of bars to return (Phase 1 target: 500–5000). */
  limit?: number;
  /** Page cursor — load bars strictly before this time (UNIX seconds). */
  before?: number;
}

// ----------------------------------------------------------------------------
// Model constants (declarative — part of the type contract, not service logic)
// ----------------------------------------------------------------------------

/** Timeframes supported in Phase 1 (subset of the app-wide `Timeframe` union). */
export const SUPPORTED_TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1H",
  "2H",
  "4H",
  "1D",
  "1W",
  "1M",
] as const satisfies readonly Timeframe[];

/** Reconnect backoff schedule in ms; providers walk this then hold at the last. */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000] as const;

/** UI metadata for each connection status (label + colour token / emoji dot). */
export const CONNECTION_STATUS_META: Record<
  ConnectionStatus,
  { label: string; color: string; emoji: string }
> = {
  disconnected: { label: "Disconnected", color: "var(--bear)", emoji: "🔴" },
  connecting: { label: "Connecting", color: "var(--choch)", emoji: "🟡" },
  connected: { label: "Connected", color: "var(--bull)", emoji: "🟢" },
  reconnecting: { label: "Reconnecting", color: "var(--choch)", emoji: "🟡" },
  error: { label: "Error", color: "var(--bear)", emoji: "🔴" },
};

/** Canonical subscription key. Keep all keys flowing through here. */
export function subscriptionKey(
  symbol: string,
  timeframe?: Timeframe,
): SubscriptionKey {
  return timeframe ? `${symbol}:${timeframe}` : symbol;
}
