"use client";
/**
 * Market Data Store (Phase 1, Step 3) — the single source of truth for all
 * realtime market data: quotes, candles, the active symbol/timeframe, the
 * connection status, and the live subscription registry.
 *
 * Converted from Zustand to Jotai atoms. Each state field is an individual
 * atom; each action is a write atom. A compatibility `useMarketDataStore`
 * hook and `getMarketDataState()` for non-React code keep the existing API.
 */
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import {
  subscriptionKey,
  type ConnectionStatus,
  type MarketCandle,
  type MarketChannel,
  type MarketQuote,
  type MarketSubscription,
  type SubscriptionKey,
  type Timeframe,
} from "@/types";
import {
  mergeHistoryWithLiveCandles,
  normalizeMarketCandle,
  normalizeMarketCandleSeries,
} from "@/services/market-data/candleSeries";

/** Keep realtime candle arrays bounded for memory/perf (Step 16). */
const MAX_CANDLES = 5000;

const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_TIMEFRAME: Timeframe = "1m";
const DEFAULT_CHANNELS: MarketChannel[] = ["kline"];

const EMPTY: MarketCandle[] = [];

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

// ── State atoms ──────────────────────────────────────────────────────────────
export const quotesAtom = atom<Record<string, MarketQuote>>({});
export const candlesAtom = atom<Record<SubscriptionKey, MarketCandle[]>>({});
export const selectedSymbolAtom = atom<string>(DEFAULT_SYMBOL);
export const selectedTimeframeAtom = atom<Timeframe>(DEFAULT_TIMEFRAME);
export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");
export const subscriptionsAtom = atom<
  Record<SubscriptionKey, MarketSubscription>
>({});
export const subRefsAtom = atom<Record<SubscriptionKey, number>>({});
export const lastUpdateAtom = atom<number>(0);

/** Incremented on every data mutation so external subscribers can react. */
export const marketDataTickAtom = atom<number>(0);

// ── Write atoms: intents (UI → service) ──────────────────────────────────────

export const connectAtom = atom(null, (_get, set) => {
  set(connectionStatusAtom, "connecting");
  service?.connect();
});

export const disconnectAtom = atom(null, (_get, set) => {
  service?.disconnect();
  set(connectionStatusAtom, "disconnected");
});

export const subscribeAtom = atom(null, (get, set, sub: MarketSubscription) => {
  const key = subscriptionKey(
    sub.symbol,
    sub.channels.includes("kline") ? sub.timeframe : undefined,
  );
  const refs = get(subRefsAtom)[key] ?? 0;
  set(subscriptionsAtom, { ...get(subscriptionsAtom), [key]: sub });
  set(subRefsAtom, { ...get(subRefsAtom), [key]: refs + 1 });
  if (refs === 0) service?.subscribe(sub); // first subscriber opens the stream
});

export const unsubscribeAtom = atom(
  null,
  (get, set, symbol: string, timeframe?: Timeframe) => {
    const key = subscriptionKey(symbol, timeframe);
    const refs = get(subRefsAtom)[key] ?? 0;
    if (refs === 0) return;
    if (refs > 1) {
      // Other consumers still need this stream — just drop a reference.
      set(subRefsAtom, { ...get(subRefsAtom), [key]: refs - 1 });
      return;
    }
    // Last subscriber → tear the stream down.
    const nextSubs = { ...get(subscriptionsAtom) };
    const nextRefs = { ...get(subRefsAtom) };
    delete nextSubs[key];
    delete nextRefs[key];
    set(subscriptionsAtom, nextSubs);
    set(subRefsAtom, nextRefs);
    service?.unsubscribe(symbol, timeframe);
  },
);

export const changeSymbolAtom = atom(null, (get, set, symbol: string) => {
  const selectedSymbol = get(selectedSymbolAtom);
  const selectedTimeframe = get(selectedTimeframeAtom);
  if (symbol === selectedSymbol) return;
  set(selectMarketAtom, symbol, selectedTimeframe);
});

export const changeTimeframeAtom = atom(
  null,
  (get, set, timeframe: Timeframe) => {
    const selectedSymbol = get(selectedSymbolAtom);
    const selectedTimeframe = get(selectedTimeframeAtom);
    if (timeframe === selectedTimeframe) return;
    set(selectMarketAtom, selectedSymbol, timeframe);
  },
);

export const selectMarketAtom = atom(
  null,
  (get, set, symbol: string, timeframe: Timeframe) => {
    const store = getDefaultStore();
    const selectedSymbol = get(selectedSymbolAtom);
    const selectedTimeframe = get(selectedTimeframeAtom);
    if (symbol !== selectedSymbol || timeframe !== selectedTimeframe) {
      store.set(unsubscribeAtom, selectedSymbol, selectedTimeframe);
      set(selectedSymbolAtom, symbol);
      set(selectedTimeframeAtom, timeframe);
    }
    store.set(subscribeAtom, { symbol, channels: DEFAULT_CHANNELS, timeframe });
  },
);

// ── Write atoms: data ingress (service → store) ──────────────────────────────

export const updateQuoteAtom = atom(null, (get, set, quote: MarketQuote) => {
  set(quotesAtom, { ...get(quotesAtom), [quote.symbol]: quote });
  set(lastUpdateAtom, Date.now());
  set(marketDataTickAtom, get(marketDataTickAtom) + 1);
});

export const updateCandleAtom = atom(
  null,
  (get, set, symbol: string, timeframe: Timeframe, candle: MarketCandle) => {
    const normalized = normalizeMarketCandle(candle);
    if (!normalized) return;

    const key = subscriptionKey(symbol, timeframe);
    const all = get(candlesAtom);
    const series = all[key] ?? [];
    const last = series[series.length - 1];
    let next: MarketCandle[];
    if (!last || normalized.time > last.time) {
      next =
        series.length >= MAX_CANDLES
          ? [...series.slice(series.length - MAX_CANDLES + 1), normalized]
          : [...series, normalized];
    } else if (normalized.time === last.time) {
      next = [...series.slice(0, -1), normalized];
    } else {
      return; // stale tick — no change
    }
    set(candlesAtom, { ...all, [key]: next });
    set(lastUpdateAtom, Date.now());
    set(marketDataTickAtom, get(marketDataTickAtom) + 1);
  },
);

export const setCandlesAtom = atom(
  null,
  (get, set, symbol: string, timeframe: Timeframe, candles: MarketCandle[]) => {
    const key = subscriptionKey(symbol, timeframe);
    const existing = get(candlesAtom)[key] ?? [];
    const trimmed =
      existing.length > 0
        ? mergeHistoryWithLiveCandles(candles, existing, MAX_CANDLES)
        : normalizeMarketCandleSeries(candles, MAX_CANDLES);
    set(candlesAtom, { ...get(candlesAtom), [key]: trimmed });
    set(lastUpdateAtom, Date.now());
    set(marketDataTickAtom, get(marketDataTickAtom) + 1);
  },
);

export const setConnectionStatusAtom = atom(
  null,
  (_get, set, status: ConnectionStatus) => {
    set(connectionStatusAtom, status);
  },
);

export const resetAtom = atom(null, (_get, set) => {
  set(quotesAtom, {});
  set(candlesAtom, {});
  set(subscriptionsAtom, {});
  set(subRefsAtom, {});
  set(connectionStatusAtom, "disconnected");
  set(lastUpdateAtom, 0);
});

// ── Combined interface (for compatibility hook + getState) ───────────────────

interface MarketDataState {
  quotes: Record<string, MarketQuote>;
  candles: Record<SubscriptionKey, MarketCandle[]>;
  selectedSymbol: string;
  selectedTimeframe: Timeframe;
  connectionStatus: ConnectionStatus;
  subscriptions: Record<SubscriptionKey, MarketSubscription>;
  subRefs: Record<SubscriptionKey, number>;
  lastUpdate: number;
}

export interface MarketDataActions {
  connect: () => void;
  disconnect: () => void;
  subscribe: (sub: MarketSubscription) => void;
  unsubscribe: (symbol: string, timeframe?: Timeframe) => void;
  changeSymbol: (symbol: string) => void;
  changeTimeframe: (timeframe: Timeframe) => void;
  selectMarket: (symbol: string, timeframe: Timeframe) => void;
  updateQuote: (quote: MarketQuote) => void;
  updateCandle: (
    symbol: string,
    timeframe: Timeframe,
    candle: MarketCandle,
  ) => void;
  setCandles: (
    symbol: string,
    timeframe: Timeframe,
    candles: MarketCandle[],
  ) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  getCandles: (symbol?: string, timeframe?: Timeframe) => MarketCandle[];
  getQuote: (symbol: string) => MarketQuote | undefined;
  reset: () => void;
}

export type MarketDataStoreInterface = MarketDataState & MarketDataActions;

const marketDataStateAtom = atom<MarketDataState>((get) => ({
  quotes: get(quotesAtom),
  candles: get(candlesAtom),
  selectedSymbol: get(selectedSymbolAtom),
  selectedTimeframe: get(selectedTimeframeAtom),
  connectionStatus: get(connectionStatusAtom),
  subscriptions: get(subscriptionsAtom),
  subRefs: get(subRefsAtom),
  lastUpdate: get(lastUpdateAtom),
}));

const marketDataCombinedAtom = atom<MarketDataStoreInterface>((get) => {
  const state = get(marketDataStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    connect: () => store.set(connectAtom),
    disconnect: () => store.set(disconnectAtom),
    subscribe: (sub) => store.set(subscribeAtom, sub),
    unsubscribe: (symbol, timeframe) =>
      store.set(unsubscribeAtom, symbol, timeframe),
    changeSymbol: (symbol) => store.set(changeSymbolAtom, symbol),
    changeTimeframe: (timeframe) => store.set(changeTimeframeAtom, timeframe),
    selectMarket: (symbol, timeframe) =>
      store.set(selectMarketAtom, symbol, timeframe),
    updateQuote: (quote) => store.set(updateQuoteAtom, quote),
    updateCandle: (symbol, timeframe, candle) =>
      store.set(updateCandleAtom, symbol, timeframe, candle),
    setCandles: (symbol, timeframe, candles) =>
      store.set(setCandlesAtom, symbol, timeframe, candles),
    setConnectionStatus: (status) => store.set(setConnectionStatusAtom, status),
    getCandles: (symbol, timeframe) => {
      const s = store.get(marketDataStateAtom);
      const key = subscriptionKey(
        symbol ?? s.selectedSymbol,
        timeframe ?? s.selectedTimeframe,
      );
      return s.candles[key] ?? EMPTY;
    },
    getQuote: (symbol) => store.get(quotesAtom)[symbol],
    reset: () => store.set(resetAtom),
  };
});

// ── Compatibility hook ───────────────────────────────────────────────────────
export function useMarketDataStore(): MarketDataStoreInterface;
export function useMarketDataStore<T>(
  selector: (state: MarketDataStoreInterface) => T,
): T;
export function useMarketDataStore<T>(
  selector?: (state: MarketDataStoreInterface) => T,
): MarketDataStoreInterface | T {
  const combined = useAtomValue(marketDataCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

// Static getState() for non-React code.
export function getMarketDataState(): MarketDataStoreInterface {
  return getDefaultStore().get(marketDataCombinedAtom);
}
