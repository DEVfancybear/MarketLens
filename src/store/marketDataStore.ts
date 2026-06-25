'use client';
/**
 * Market Data Store (Phase 1, Step 3) — the single source of truth for all
 * realtime market data: quotes, candles, the active symbol/timeframe, the
 * connection status, and the live subscription registry.
 *
 * Design:
 *  - Pure state + state-mutation actions. **No provider/socket logic here** —
 *    that lives in `MarketDataService` (Step 6) and is attached at runtime via
 *    `attachMarketDataService()`, avoiding a circular store↔service dependency.
 *  - Data ingress (service → store): `updateQuote`, `updateCandle`, `setCandles`,
 *    `setConnectionStatus`.
 *  - Intents (UI → service): `connect`, `disconnect`, `subscribe`, `unsubscribe`,
 *    `changeSymbol`, `changeTimeframe` — these update store state AND delegate
 *    to the bound service when present.
 *
 * NOTE: This store is introduced standalone in Step 3. Wiring the chart /
 * watchlist over to it (and retiring the mock paths in `chartStore`) happens in
 * Steps 10–13. Until then it coexists with `chartStore`.
 *
 * Placed in `src/store/` (not `src/stores/`) to match the existing convention
 * and avoid a duplicate store directory.
 */
import { create } from 'zustand';
import {
  subscriptionKey,
  type ConnectionStatus,
  type MarketCandle,
  type MarketChannel,
  type MarketQuote,
  type MarketSubscription,
  type SubscriptionKey,
  type Timeframe,
} from '@/types';

/** Keep realtime candle arrays bounded for memory/perf (Step 16). */
const MAX_CANDLES = 5000;

const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_TIMEFRAME: Timeframe = '1m';
// The chart selection subscribes KLINE only (price comes from the candle close).
// The watchlist subscribes TICKER separately, so the two never share a stream
// and neither can tear down the other's subscriptions.
const DEFAULT_CHANNELS: MarketChannel[] = ['kline'];

/** Minimal surface the store calls on the (Step 6) service. */
export interface MarketDataServiceBinding {
  connect(): void;
  disconnect(): void;
  subscribe(sub: MarketSubscription): void;
  unsubscribe(symbol: string, timeframe?: Timeframe): void;
}

/** Module-level service binding (not React state — services don't belong in state). */
let service: MarketDataServiceBinding | null = null;

/** Attach the realtime service (called once from app bootstrap in Step 6+). */
export function attachMarketDataService(svc: MarketDataServiceBinding | null) {
  service = svc;
}

interface MarketDataState {
  // ---- data ----
  /** Latest quote per symbol. */
  quotes: Record<string, MarketQuote>;
  /** Candle series keyed by `symbol:timeframe`. */
  candles: Record<SubscriptionKey, MarketCandle[]>;

  // ---- selection ----
  selectedSymbol: string;
  selectedTimeframe: Timeframe;

  // ---- connection ----
  connectionStatus: ConnectionStatus;

  // ---- subscription registry ----
  subscriptions: Record<SubscriptionKey, MarketSubscription>;

  /** Epoch ms of the most recent data mutation. */
  lastUpdate: number;

  // ---- intents (UI → service) ----
  connect: () => void;
  disconnect: () => void;
  subscribe: (sub: MarketSubscription) => void;
  unsubscribe: (symbol: string, timeframe?: Timeframe) => void;
  changeSymbol: (symbol: string) => void;
  changeTimeframe: (timeframe: Timeframe) => void;
  /** Atomically switch symbol + timeframe (chart selection). */
  selectMarket: (symbol: string, timeframe: Timeframe) => void;

  // ---- data ingress (service → store) ----
  updateQuote: (quote: MarketQuote) => void;
  updateCandle: (symbol: string, timeframe: Timeframe, candle: MarketCandle) => void;
  setCandles: (symbol: string, timeframe: Timeframe, candles: MarketCandle[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;

  // ---- selectors ----
  getCandles: (symbol?: string, timeframe?: Timeframe) => MarketCandle[];
  getQuote: (symbol: string) => MarketQuote | undefined;
  reset: () => void;
}

const EMPTY: MarketCandle[] = [];

export const useMarketDataStore = create<MarketDataState>((set, get) => ({
  quotes: {},
  candles: {},
  selectedSymbol: DEFAULT_SYMBOL,
  selectedTimeframe: DEFAULT_TIMEFRAME,
  connectionStatus: 'disconnected',
  subscriptions: {},
  lastUpdate: 0,

  // ---------------- intents ----------------
  connect: () => {
    set({ connectionStatus: 'connecting' });
    service?.connect();
  },

  disconnect: () => {
    service?.disconnect();
    set({ connectionStatus: 'disconnected' });
  },

  subscribe: (sub) => {
    const key = subscriptionKey(sub.symbol, sub.channels.includes('kline') ? sub.timeframe : undefined);
    if (get().subscriptions[key]) return; // already subscribed
    set((s) => ({ subscriptions: { ...s.subscriptions, [key]: sub } }));
    service?.subscribe(sub);
  },

  unsubscribe: (symbol, timeframe) => {
    const key = subscriptionKey(symbol, timeframe);
    if (!get().subscriptions[key]) return;
    set((s) => {
      const next = { ...s.subscriptions };
      delete next[key];
      return { subscriptions: next };
    });
    service?.unsubscribe(symbol, timeframe);
  },

  /** Switch active symbol (kline only): unsubscribe old, subscribe new. No leaks. */
  changeSymbol: (symbol) => {
    const { selectedSymbol, selectedTimeframe } = get();
    if (symbol === selectedSymbol) return;
    get().selectMarket(symbol, selectedTimeframe);
  },

  /** Switch active timeframe: re-subscribe kline at the new TF for the active symbol. */
  changeTimeframe: (timeframe) => {
    const { selectedSymbol, selectedTimeframe } = get();
    if (timeframe === selectedTimeframe) return;
    get().selectMarket(selectedSymbol, timeframe);
  },

  /** Atomically switch the active symbol+timeframe (chart selection): drop the
   *  old kline subscription and add the new one. History loading is done by the
   *  chart/hook layer.
   *
   *  Idempotent: when the selection is unchanged it still (re)asserts the kline
   *  subscription for the active key. This matters on first mount — if the chart
   *  default already equals the store default, an early-return would otherwise
   *  leave the chart with history but no live kline stream. `subscribe()` dedupes,
   *  so re-asserting an existing subscription is a no-op. */
  selectMarket: (symbol, timeframe) => {
    const { selectedSymbol, selectedTimeframe, unsubscribe, subscribe } = get();
    if (symbol !== selectedSymbol || timeframe !== selectedTimeframe) {
      unsubscribe(selectedSymbol, selectedTimeframe); // drop old chart kline
      set({ selectedSymbol: symbol, selectedTimeframe: timeframe });
    }
    subscribe({ symbol, channels: DEFAULT_CHANNELS, timeframe }); // dedup-guarded
  },

  // ---------------- data ingress ----------------
  updateQuote: (quote) =>
    set((s) => ({
      quotes: { ...s.quotes, [quote.symbol]: quote },
      lastUpdate: Date.now(),
    })),

  /**
   * TradingView-style realtime merge: upsert the last bar by time.
   *  - same open time  → replace (the forming bar ticking)
   *  - newer open time → append (a new bar opened), trimmed to MAX_CANDLES
   *  - older           → ignore (stale)
   */
  updateCandle: (symbol, timeframe, candle) => {
    const key = subscriptionKey(symbol, timeframe);
    set((s) => {
      const series = s.candles[key] ?? [];
      const last = series[series.length - 1];
      let next: MarketCandle[];
      if (!last || candle.time > last.time) {
        next = series.length >= MAX_CANDLES
          ? [...series.slice(series.length - MAX_CANDLES + 1), candle]
          : [...series, candle];
      } else if (candle.time === last.time) {
        next = [...series.slice(0, -1), candle];
      } else {
        return s; // stale tick — no change
      }
      return { candles: { ...s.candles, [key]: next }, lastUpdate: Date.now() };
    });
  },

  /** Replace a whole series (historical load from HistoricalDataService, Step 7). */
  setCandles: (symbol, timeframe, candles) => {
    const key = subscriptionKey(symbol, timeframe);
    const trimmed = candles.length > MAX_CANDLES ? candles.slice(candles.length - MAX_CANDLES) : candles;
    set((s) => ({ candles: { ...s.candles, [key]: trimmed }, lastUpdate: Date.now() }));
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  // ---------------- selectors ----------------
  getCandles: (symbol, timeframe) => {
    const { selectedSymbol, selectedTimeframe, candles } = get();
    const key = subscriptionKey(symbol ?? selectedSymbol, timeframe ?? selectedTimeframe);
    return candles[key] ?? EMPTY;
  },

  getQuote: (symbol) => get().quotes[symbol],

  reset: () =>
    set({ quotes: {}, candles: {}, subscriptions: {}, connectionStatus: 'disconnected', lastUpdate: 0 }),
}));
