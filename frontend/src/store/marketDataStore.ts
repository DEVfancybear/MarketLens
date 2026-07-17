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
  type DrawingDataTick,
  type MarketSubscription,
  type SubscriptionKey,
  type Timeframe,
} from "@/types";
import {
  marketCandleSeriesEqual,
  mergeHistoryWithLiveCandles,
  normalizeMarketCandle,
  normalizeMarketCandleSeries,
  upsertMarketCandleIntoSeries,
} from "@/services/market-data/candleSeries";
import {
  createCandleRepository,
  findCandleIndexByTime,
  evictCandleRepositories,
  materializeCandleRepository,
  mergeHistoryIntoCandleRepository,
  upsertCandleRepository,
  type CandleRepository,
} from "@/services/market-data/candleRepository";
import {
  beginChartPerformanceMeasure,
  incrementChartPerformanceCounter,
} from "@/services/chartPerformanceProbe";
import { getChartOptimizationDecision } from "@/services/chartOptimizationRollout";
import {
  measuredCumulativeVolumeDelta,
  normalizedCumulativeVolume,
} from "@/services/market-data/quoteVolume";

/** Keep realtime candle arrays bounded for memory/perf (Step 16). */
export const MAX_CANDLES_PER_SERIES = 5000;
const MAX_CANDLES = MAX_CANDLES_PER_SERIES;
const CANDLE_CACHE_BUDGET = { maxRepositories: 10, maxCandles: 50_000 } as const;

const DEFAULT_SYMBOL = "";
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
export const candleRepositoriesAtom = atom<Record<SubscriptionKey, CandleRepository>>({});
export const selectedSymbolAtom = atom<string>(DEFAULT_SYMBOL);
export const selectedTimeframeAtom = atom<Timeframe>(DEFAULT_TIMEFRAME);
export const connectionStatusAtom = atom<ConnectionStatus>("disconnected");
export const subscriptionsAtom = atom<
  Record<SubscriptionKey, MarketSubscription>
>({});

const MAX_RECENT_MARKET_TICKS = 20_000;
const recentMarketTicks = new Map<string, DrawingDataTick[]>();
/** Last cumulative/session quote volume, used to derive per-update volume. */
const recentMarketQuoteVolumes = new Map<string, number>();

function recordRecentMarketTick(quote: MarketQuote): void {
  if (!Number.isFinite(quote.last) || quote.last <= 0 || !Number.isFinite(quote.timestamp)) return;
  const symbol = quote.symbol.trim().toUpperCase();
  const ticks = recentMarketTicks.get(symbol) ?? [];
  const previous = ticks[ticks.length - 1];
  const time = quote.timestamp >= 100_000_000_000
    ? quote.timestamp / 1000
    : quote.timestamp;
  const cumulativeVolume = normalizedCumulativeVolume(quote.volume);
  const previousCumulativeVolume = recentMarketQuoteVolumes.get(symbol);
  const measuredVolume = measuredCumulativeVolumeDelta(
    quote.volume,
    previousCumulativeVolume,
  );
  if (cumulativeVolume != null) recentMarketQuoteVolumes.set(symbol, cumulativeVolume);
  const volume = measuredVolume;
  if (previous?.time === time && previous.price === quote.last) {
    if (volume != null) previous.volume = (previous.volume ?? 0) + volume;
    return;
  }
  const direction = previous
    ? quote.last > previous.price
      ? "up" as const
      : quote.last < previous.price
        ? "down" as const
        : undefined
    : undefined;
  ticks.push({
    time,
    price: quote.last,
    ...(volume != null ? { volume } : {}),
    ...(direction ? { direction } : {}),
  });
  if (ticks.length > MAX_RECENT_MARKET_TICKS) {
    ticks.splice(0, ticks.length - MAX_RECENT_MARKET_TICKS);
  }
  recentMarketTicks.set(symbol, ticks);
}

/** Immutable tick-volume evidence retained for newly created profile drawings. */
export function getRecentMarketTicks(
  symbol: string,
  start = Number.NEGATIVE_INFINITY,
  end = Number.POSITIVE_INFINITY,
): DrawingDataTick[] {
  return (recentMarketTicks.get(symbol.trim().toUpperCase()) ?? [])
    .filter((tick) => (tick.time ?? 0) >= start && (tick.time ?? 0) <= end)
    .map((tick) => ({ ...tick }));
}

/**
 * Explicit retained-ring bounds for completeness checks. A caller may use
 * ticks only when its entire requested interval sits inside these bounds.
 */
export function getRecentMarketTickCoverage(
  symbol: string,
): { start: number; end: number } | undefined {
  const times = (recentMarketTicks.get(symbol.trim().toUpperCase()) ?? [])
    .flatMap((tick) => Number.isFinite(tick.time) ? [tick.time!] : []);
  if (times.length === 0) return undefined;
  return {
    start: Math.min(...times),
    end: Math.max(...times),
  };
}
export const subRefsAtom = atom<Record<SubscriptionKey, number>>({});
export const lastUpdateAtom = atom<number>(0);

/** Incremented on every data mutation so external subscribers can react. */
export const marketDataTickAtom = atom<number>(0);

function countSharedChunks(
  previous: CandleRepository | undefined,
  next: CandleRepository,
) {
  if (!previous) return 0;
  const previousChunks = new Set(previous.chunks);
  return next.chunks.filter((chunk) => previousChunks.has(chunk)).length;
}

function commitCandleRepository(
  repositories: Record<SubscriptionKey, CandleRepository>,
  flatSeries: Record<SubscriptionKey, MarketCandle[]>,
  key: SubscriptionKey,
  repository: CandleRepository,
  protectedKeys: ReadonlySet<string>,
  preparedFlat?: MarketCandle[],
) {
  const withRepository = { ...repositories, [key]: repository };
  const budgeted = evictCandleRepositories(
    withRepository,
    protectedKeys,
    CANDLE_CACHE_BUDGET,
  ) as Record<SubscriptionKey, CandleRepository>;
  let materialized = preparedFlat;
  if (!materialized) {
    const endMaterialize = beginChartPerformanceMeasure("candle.repository.materialize", {
      candles: repository.length,
      chunks: repository.chunks.length,
    });
    materialized = materializeCandleRepository(repository);
    endMaterialize();
  }
  const nextFlat = { ...flatSeries, [key]: materialized };
  let evictions = 0;
  for (const existingKey of Object.keys(nextFlat) as SubscriptionKey[]) {
    if (!budgeted[existingKey]) {
      delete nextFlat[existingKey];
      evictions += 1;
    }
  }
  if (evictions > 0) incrementChartPerformanceCounter("candle.repository.evictions", evictions);
  return { repositories: budgeted, flatSeries: nextFlat };
}

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
  recordRecentMarketTick(quote);
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
    const rollout = getChartOptimizationDecision(Math.max(series.length, 1));
    incrementChartPerformanceCounter(
      rollout.chunkRepository
        ? "rollout.repository.optimizedWrites"
        : "rollout.repository.legacyWrites",
    );
    if (!rollout.chunkRepository) {
      const next = upsertMarketCandleIntoSeries(series, normalized, MAX_CANDLES);
      if (
        next.length === series.length &&
        next.every((item, index) => item === series[index])
      ) return;
      set(candlesAtom, { ...all, [key]: next });
      set(lastUpdateAtom, Date.now());
      set(marketDataTickAtom, get(marketDataTickAtom) + 1);
      return;
    }
    const repositories = get(candleRepositoriesAtom);
    const previous = repositories[key] ?? createCandleRepository(series, MAX_CANDLES);
    const endUpsert = beginChartPerformanceMeasure("candle.repository.upsert", {
      candles: previous.length,
      chunks: previous.chunks.length,
    });
    const next = upsertCandleRepository(previous, normalized, MAX_CANDLES);
    endUpsert();
    if (next === previous) return;
    const shared = countSharedChunks(previous, next);
    incrementChartPerformanceCounter("candle.repository.chunksReused", shared);
    incrementChartPerformanceCounter(
      "candle.repository.chunksCreated",
      Math.max(0, next.chunks.length - shared),
    );
    const activeKey = subscriptionKey(get(selectedSymbolAtom), get(selectedTimeframeAtom));
    const committed = commitCandleRepository(
      repositories,
      all,
      key,
      next,
      new Set([key, activeKey]),
    );
    set(candleRepositoriesAtom, committed.repositories);
    set(candlesAtom, committed.flatSeries);
    set(lastUpdateAtom, Date.now());
    set(marketDataTickAtom, get(marketDataTickAtom) + 1);
  },
);

export const setCandlesAtom = atom(
  null,
  (
    get,
    set,
    symbol: string,
    timeframe: Timeframe,
    candles: MarketCandle[],
    mode: "merge" | "replace" = "merge",
  ) => {
    const key = subscriptionKey(symbol, timeframe);
    const all = get(candlesAtom);
    const existing = all[key] ?? [];
    const rollout = getChartOptimizationDecision(Math.max(existing.length, candles.length));
    incrementChartPerformanceCounter(
      rollout.chunkRepository
        ? "rollout.repository.optimizedWrites"
        : "rollout.repository.legacyWrites",
    );
    if (!rollout.chunkRepository) {
      const trimmed = mode === "replace"
        ? normalizeMarketCandleSeries(candles, MAX_CANDLES)
        : existing.length > 0
        ? mergeHistoryWithLiveCandles(candles, existing, MAX_CANDLES)
        : normalizeMarketCandleSeries(candles, MAX_CANDLES);
      if (marketCandleSeriesEqual(existing, trimmed)) return;
      if (mode === "replace") {
        const repositories = get(candleRepositoriesAtom);
        if (repositories[key]) {
          const nextRepositories = { ...repositories };
          delete nextRepositories[key];
          set(candleRepositoriesAtom, nextRepositories);
        }
      }
      set(candlesAtom, { ...all, [key]: trimmed });
      set(lastUpdateAtom, Date.now());
      set(marketDataTickAtom, get(marketDataTickAtom) + 1);
      return;
    }
    const repositories = get(candleRepositoriesAtom);
    const previous = repositories[key] ?? createCandleRepository(existing, MAX_CANDLES);
    const endMerge = beginChartPerformanceMeasure("candle.repository.merge", {
      historyCandles: candles.length,
      existingCandles: previous.length,
      chunks: previous.chunks.length,
    });
    const next = mode === "replace"
      ? createCandleRepository(candles, MAX_CANDLES)
      : existing.length > 0
      ? mergeHistoryIntoCandleRepository(previous, candles, MAX_CANDLES)
      : createCandleRepository(candles, MAX_CANDLES);
    endMerge();
    if (next === previous) return;
    const endMaterialize = beginChartPerformanceMeasure("candle.repository.materialize", {
      candles: next.length,
      chunks: next.chunks.length,
    });
    const materialized = materializeCandleRepository(next);
    endMaterialize();
    if (marketCandleSeriesEqual(existing, materialized) && repositories[key]) return;
    const shared = countSharedChunks(previous, next);
    incrementChartPerformanceCounter("candle.repository.chunksReused", shared);
    incrementChartPerformanceCounter(
      "candle.repository.chunksCreated",
      Math.max(0, next.chunks.length - shared),
    );
    const activeKey = subscriptionKey(get(selectedSymbolAtom), get(selectedTimeframeAtom));
    const committed = commitCandleRepository(
      repositories,
      all,
      key,
      next,
      new Set([key, activeKey]),
      materialized,
    );
    set(candleRepositoriesAtom, committed.repositories);
    set(candlesAtom, committed.flatSeries);
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
  recentMarketTicks.clear();
  recentMarketQuoteVolumes.clear();
  set(quotesAtom, {});
  set(candlesAtom, {});
  set(candleRepositoriesAtom, {});
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
  replaceCandles: (
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
    replaceCandles: (symbol, timeframe, candles) =>
      store.set(setCandlesAtom, symbol, timeframe, candles, "replace"),
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

/** Phase 3 canonical access for range-aware consumers migrating off flat arrays. */
export function getMarketCandleRepository(
  symbol?: string,
  timeframe?: Timeframe,
): CandleRepository | undefined {
  const store = getDefaultStore();
  const selectedSymbol = symbol ?? store.get(selectedSymbolAtom);
  const selectedTimeframe = timeframe ?? store.get(selectedTimeframeAtom);
  return store.get(candleRepositoriesAtom)[subscriptionKey(selectedSymbol, selectedTimeframe)];
}

/** Exact timestamp lookup without flattening or scanning the compatibility view. */
export function findMarketCandleIndexByTime(
  time: number,
  symbol?: string,
  timeframe?: Timeframe,
) {
  const repository = getMarketCandleRepository(symbol, timeframe);
  return repository ? findCandleIndexByTime(repository, time) : -1;
}
