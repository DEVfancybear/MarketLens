"use client";
/**
 * useMarketData (Phase 1, Step 11) — realtime chart feed.
 *
 * Replaces the previous mock loader. It bridges the chart's selection
 * (`chartStore.symbol/timeframe`) to the realtime pipeline:
 *
 *  1. On symbol/timeframe change → `marketDataStore.selectMarket()` (subscribe
 *     the kline stream, drop the old one) and load history via
 *     `HistoricalDataService` into `marketDataStore`.
 *  2. Continuously mirror the store's candle series for the active key into
 *     `chartStore.candles`, so the rest of the live app (chart, indicators,
 *     SMC and simulator trading) keeps reading `chartStore.candles`
 *     unchanged — now fed by realtime data instead of the mock generator.
 *
 * No sockets are created here; the MarketDataService/providers own connections.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { symbolAtom, timeframeAtom, setCandlesAtom, setLoadingAtom } from "@/store/chartStore";
import { getDefaultStore } from "jotai";
import { logAtom } from "@/store/uiStore";
import { getMarketDataState, MAX_CANDLES_PER_SERIES } from "@/store/marketDataStore";
import { useCandles } from "@/hooks/useCandles";
import { getMarketDataService } from "@/services/market-data/MarketDataService";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import { invalidateIndicatorHistoryContext } from "@/services/indicatorRuntimeCache";
import { TF_SECONDS, type Candle, type LoadMoreHistoryResult, type Timeframe } from "@/types";
import { findRecentCandleGap, hasDiscontinuousHistoryTail } from "@/services/market-data/candleSeries";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { marketSymbolCatalogStatusAtom, marketSymbolsAtom } from "@/store/marketSymbolStore";
import {
  HISTORY_SELECTION_DEBOUNCE_MS,
  historyPageBars,
  initialHistoryBars,
  mt5ActiveHistoryRequest,
  mt5HistoryRefreshMs,
  mt5RefreshBars,
  mt5TailContinuitySeconds,
} from "@/services/market-data/historyPolicy";

const MAX_BACKFILL_MISSING_BARS = 50;
const MT5_ACTIVE_REFRESH_RETRY_DELAYS_MS = [1_000, 3_000] as const;
const MT5_PENDING_BACKFILL_POLL_MS = 750;

export interface LoadedGoToHistory {
  candles: Candle[];
  requestedTime: number;
  resolvedTime: number;
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === "AbortError";
  return (error as { name?: string }).name === "AbortError";
}

export function useMarketData({ enabled = true }: { enabled?: boolean } = {}) {
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const setCandles = useSetAtom(setCandlesAtom);
  const setLoading = useSetAtom(setLoadingAtom);
  const catalogStatus = useAtomValue(marketSymbolCatalogStatusAtom);
  const catalogSize = useAtomValue(marketSymbolsAtom).length;
  const backfilledGapsRef = useRef<Set<string>>(new Set());
  const mt5NeedsFullRefreshRef = useRef<string | null>(null);
  const mt5BackfillPendingRef = useRef<string | null>(null);
  const mt5RefreshSelectionRef = useRef<string | null>(null);
  const olderHistoryInFlightRef = useRef(false);
  const olderHistoryControllerRef = useRef<AbortController | null>(null);
  const olderHistoryGenerationRef = useRef(0);
  const exhaustedOlderHistoryRef = useRef<Set<string>>(new Set());
  const activeKey = `${symbol}:${timeframe}`;
  const activeSelectionRef = useRef(activeKey);
  activeSelectionRef.current = activeKey;
  const [historyReadyKey, setHistoryReadyKey] = useState<string | null>(null);

  // Realtime candle series from the store for the active symbol+timeframe.
  const liveCandles = useCandles(symbol, timeframe);

  useEffect(() => {
    if (!enabled) setLoading(false);
  }, [enabled, setLoading, symbol, timeframe]);

  useEffect(() => {
    olderHistoryGenerationRef.current += 1;
    backfilledGapsRef.current.clear();
    olderHistoryControllerRef.current?.abort();
    olderHistoryControllerRef.current = null;
    olderHistoryInFlightRef.current = false;
    exhaustedOlderHistoryRef.current.clear();
    return () => {
      olderHistoryGenerationRef.current += 1;
      olderHistoryControllerRef.current?.abort();
      olderHistoryControllerRef.current = null;
      olderHistoryInFlightRef.current = false;
    };
  }, [activeKey, enabled]);

  // ---- Select market + load history on symbol/timeframe change ----
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const key = `${symbol}:${timeframe}`;
    setHistoryReadyKey(null);
    if (mt5RefreshSelectionRef.current !== key) {
      mt5RefreshSelectionRef.current = key;
      mt5NeedsFullRefreshRef.current = null;
      mt5BackfillPendingRef.current = null;
    }

    const meta = symbol ? getMarketSymbol(symbol) : undefined;
    if (meta?.provider !== "mt5") {
      mt5NeedsFullRefreshRef.current = null;
      mt5BackfillPendingRef.current = null;
    }
    if (!symbol || !meta) {
      // The MT5 registry is hydrated asynchronously from the backend. On a cold
      // page load the chart can mount before /api/v1/mt5/symbols completes; do
      // not clear the chart as "unknown symbol" while the catalog is still
      // loading. The catalog atoms are dependencies below, so this effect runs
      // again and loads history once the backend catalog is ready.
      if (symbol && (catalogStatus === "idle" || catalogStatus === "loading")) {
        setLoading(true);
        return () => {
          cancelled = true;
        };
      }
      getMarketDataState().setCandles(symbol, timeframe, []);
      setCandles([]);
      setLoading(false);
      setHistoryReadyKey(key);
      return () => {
        cancelled = true;
      };
    }

    getMarketDataService(); // ensure the service exists + is bound to the store

    const marketData = getMarketDataState();
    const cached = marketData.getCandles(symbol, timeframe) as Candle[];
    const hasCachedHistory = cached.length > 0;
    if (hasCachedHistory) {
      // Timeframe caches remain in marketDataStore. Paint them synchronously and
      // revalidate in the background instead of covering the chart with a
      // spinner every time the user switches back to an already visited frame.
      marketData.selectMarket(symbol, timeframe);
      setCandles(cached);
      setHistoryReadyKey(key);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const historyLimit = initialHistoryBars(timeframe);

    // The active-chart effect below immediately performs one authoritative
    // latest-window refresh for an already painted cache. Do not race it with a
    // second, larger refresh whose later response could regress the forming bar.
    if (hasCachedHistory && meta.provider === "mt5") {
      return () => {
        cancelled = true;
      };
    }

    const controller = new AbortController();

    // Deferring one tick avoids React Strict Mode's mount/cleanup probe from
    // issuing a real HTTP request. It also collapses rapid timeframe clicks so
    // MT5 only receives work for the selection the user actually stopped on.
    const requestTimer = window.setTimeout(() => {
      getHistoricalDataService()
        .loadHistoryPage(
          {
            symbol,
            timeframe,
            limit: historyLimit,
            refresh: meta.provider === "mt5" ? undefined : hasCachedHistory || undefined,
          },
          {
            signal: controller.signal,
          },
        )
        .then((page) => {
          if (cancelled || activeSelectionRef.current !== key) return;
          const hist = page.candles;
          if (meta.provider === "mt5") {
            // An ordinary cold read may intentionally paint a stale/unknown
            // window. Make the immediately-following authoritative request use
            // the full initial limit as well, so the backend's cancellation of
            // its lower-priority background read cannot leave us with a tiny
            // tail-only replacement.
            mt5NeedsFullRefreshRef.current =
              page.authoritative === false || page.stale === true || page.refreshPending === true
                ? key
                : null;
            mt5BackfillPendingRef.current = page.refreshPending === true ? key : null;
          }
          // Seed history before subscribing. For MT5, candles must come from
          // MT5 rates/history; ticks are used only for quotes/watchlist.
          getMarketDataState().setCandles(symbol, timeframe, hist);
          getMarketDataState().selectMarket(symbol, timeframe);
          const nextCandles = getMarketDataState().getCandles(symbol, timeframe) as Candle[];
          setCandles(nextCandles);
          setHistoryReadyKey(key);
          setLoading(false);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          if (cancelled || activeSelectionRef.current !== key) return;
          if (!hasCachedHistory) {
            getMarketDataState().setCandles(symbol, timeframe, []);
            setCandles([]);
          }
          if (meta.provider === "mt5") {
            // Let the bounded active refresh recover a cold/empty first load;
            // otherwise historyReadyKey would remain null and no retry would run.
            getMarketDataState().selectMarket(symbol, timeframe);
            setHistoryReadyKey(key);
          }
          setLoading(false);
          getDefaultStore().set(
            logAtom,
            hasCachedHistory ? "warn" : "error",
            `History load failed for ${symbol} ${timeframe}: ${String(err?.message ?? err)}`,
          );
        });
    }, HISTORY_SELECTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(requestTimer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe, catalogStatus, catalogSize, enabled]);

  // ---- Mirror store candles → chartStore (drives chart/SMC/replay/trade) ----
  useEffect(() => {
    if (!enabled) return;
    if (historyReadyKey !== activeKey) return;
    const nextCandles = liveCandles as Candle[];
    setCandles(nextCandles);
  }, [activeKey, enabled, historyReadyKey, liveCandles, setCandles]);

  // ---- MT5 active-chart refresh: update OHLC from MT5 rates, not bid/ask ticks ----
  useEffect(() => {
    if (!enabled) return;
    const meta = symbol ? getMarketSymbol(symbol) : undefined;
    if (!symbol || meta?.provider !== "mt5" || historyReadyKey !== activeKey) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let activeController: AbortController | null = null;
    let retryAttempt = 0;
    let retryTimer: number | null = null;

    const refreshLatestBars = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      activeController = new AbortController();
      try {
        const needsFullRefresh = mt5NeedsFullRefreshRef.current === activeKey;
        const waitsForBackfill = mt5BackfillPendingRef.current === activeKey;
        const request = mt5ActiveHistoryRequest(timeframe, needsFullRefresh, waitsForBackfill);
        const page = await getHistoricalDataService().loadHistoryPage(
          {
            symbol,
            timeframe,
            limit: request.limit,
            // A cold first paint already owns a full-window background fill in
            // the backend. Poll its in-memory snapshot instead of issuing an
            // explicit refresh that cannot interrupt the native MT5 call and
            // would only queue behind it.
            refresh: request.refresh,
          },
          {
            signal: activeController.signal,
          },
        );
        if (cancelled) return;
        if (waitsForBackfill && page.refreshPending) {
          if (retryTimer === null) {
            retryTimer = window.setTimeout(() => {
              retryTimer = null;
              void refreshLatestBars();
            }, MT5_PENDING_BACKFILL_POLL_MS);
          }
          return;
        }
        const hist = page.candles;
        const marketData = getMarketDataState();
        if (waitsForBackfill) {
          // The background request used the original countBack window, so its
          // completed snapshot is a safe full replacement for the viewport seed.
          marketData.replaceCandles(symbol, timeframe, hist);
          invalidateIndicatorHistoryContext(symbol, timeframe);
          mt5BackfillPendingRef.current = null;
          mt5NeedsFullRefreshRef.current = null;
          retryAttempt = 0;
          return;
        }
        const current = marketData.getCandles(symbol, timeframe);
        const discontinuous = hasDiscontinuousHistoryTail(
          current,
          hist,
          mt5TailContinuitySeconds(timeframe),
        );
        if (discontinuous) {
          // The first MT5 request can expose a stale terminal cache while the
          // timeframe warms. A tiny latest-bars merge cannot remove that bad
          // window, so re-fetch and authoritatively replace the active cache.
          const replacement = await getHistoricalDataService().loadHistory(
            {
              symbol,
              timeframe,
              limit: Math.min(
                MAX_CANDLES_PER_SERIES,
                Math.max(initialHistoryBars(timeframe), current.length),
              ),
              refresh: true,
            },
            {
              signal: activeController.signal,
            },
          );
          if (cancelled) return;
          marketData.replaceCandles(symbol, timeframe, replacement);
          // A replacement can change the entire warm-up window. Drop the
          // indicator context only after the authoritative replacement succeeds;
          // ordinary tail updates already change the candle-signature cache key
          // and should not force an expensive warm-up reload every poll.
          invalidateIndicatorHistoryContext(symbol, timeframe);
        } else {
          marketData.setCandles(symbol, timeframe, hist);
          if (current.length === 0) {
            invalidateIndicatorHistoryContext(symbol, timeframe);
          }
        }
        mt5NeedsFullRefreshRef.current = null;
        retryAttempt = 0;
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer);
          retryTimer = null;
        }
      } catch (err) {
        if (isAbortError(err)) return;
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        getDefaultStore().set(logAtom, "warn", `MT5 latest bars refresh failed for ${symbol} ${timeframe}: ${message}`);
        if (retryAttempt < MT5_ACTIVE_REFRESH_RETRY_DELAYS_MS.length && retryTimer === null) {
          const retryDelay = MT5_ACTIVE_REFRESH_RETRY_DELAYS_MS[retryAttempt];
          retryAttempt += 1;
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void refreshLatestBars();
          }, retryDelay);
        }
      } finally {
        activeController = null;
        inFlight = false;
      }
    };

    // Revalidate immediately on every active MT5 selection. This turns a fast
    // stale/unknown first paint into an authoritative window without waiting
    // for the timeframe's periodic interval (up to five minutes on 1W/1M).
    void refreshLatestBars();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        retryAttempt = 0;
        void refreshLatestBars();
      }
    }, mt5HistoryRefreshMs(timeframe));
    return () => {
      cancelled = true;
      activeController?.abort();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      window.clearInterval(timer);
    };
  }, [activeKey, enabled, historyReadyKey, symbol, timeframe]);

  // ---- Repair short realtime gaps without a full page refresh ----
  useEffect(() => {
    if (!enabled) return;
    const meta = symbol ? getMarketSymbol(symbol) : undefined;
    if (!symbol || !meta || meta.provider === "mt5") return;

    const step = TF_SECONDS[timeframe];
    const gap = findRecentCandleGap(liveCandles, step, MAX_BACKFILL_MISSING_BARS);
    if (!gap) return;

    const gapKey = `${symbol}:${timeframe}:${gap.afterTime}:${gap.beforeTime}`;
    if (backfilledGapsRef.current.has(gapKey)) return;
    backfilledGapsRef.current.add(gapKey);

    const limit = Math.min(Math.max(gap.missingBars + 4, 20), 200);
    const controller = new AbortController();
    getHistoricalDataService()
      .loadHistory({
        symbol,
        timeframe,
        limit,
        before: gap.beforeTime,
      }, { signal: controller.signal })
      .then((hist) => {
        if (
          controller.signal.aborted ||
          activeSelectionRef.current !== activeKey
        ) return;
        getMarketDataState().setCandles(symbol, timeframe, hist);
      })
      .catch((err) => {
        if (
          controller.signal.aborted ||
          activeSelectionRef.current !== activeKey ||
          isAbortError(err)
        ) return;
        getDefaultStore().set(
          logAtom,
          "error",
          `Gap backfill failed for ${symbol} ${timeframe}: ${String(err?.message ?? err)}`,
        );
      });
    return () => controller.abort();
  }, [activeKey, enabled, liveCandles, symbol, timeframe]);

  const loadOlderCandles = useCallback(async (): Promise<LoadMoreHistoryResult> => {
    const retry = (): LoadMoreHistoryResult => ({ status: "retry" });
    if (!enabled) return retry();
    if (historyReadyKey !== activeKey) return retry();
    const store = getDefaultStore();

    const current = getMarketDataState().getCandles(symbol, timeframe);
    const first = current[0];
    if (!symbol || !first || olderHistoryInFlightRef.current) return retry();

    const cursorKey = `${symbol}:${timeframe}:${first.time}`;
    if (exhaustedOlderHistoryRef.current.has(cursorKey)) {
      return { status: "exhausted" };
    }

    const generation = olderHistoryGenerationRef.current;
    const controller = new AbortController();
    olderHistoryInFlightRef.current = true;
    olderHistoryControllerRef.current = controller;
    try {
      const page = await getHistoricalDataService().loadHistoryPage(
        {
          symbol,
          timeframe,
          limit: historyPageBars(timeframe),
          before: first.time,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || generation !== olderHistoryGenerationRef.current) {
        return retry();
      }

      const older = page.candles;
      if (older.length === 0) {
        // MT5 marks a genuine end-of-history explicitly. An unannotated empty
        // page is retryable because a cold terminal can return it temporarily.
        if (page.hasMore === false) {
          exhaustedOlderHistoryRef.current.add(cursorKey);
          return { status: "exhausted" };
        }
        return retry();
      }
      if (older[0]!.time >= first.time) {
        if (page.hasMore === false) {
          exhaustedOlderHistoryRef.current.add(cursorKey);
          return { status: "exhausted" };
        }
        return retry();
      }
      getMarketDataState().setCandles(symbol, timeframe, older);
      const merged = getMarketDataState().getCandles(symbol, timeframe);
      if (!merged[0] || merged[0].time >= first.time) {
        // A bounded in-memory window can discard an older page. Once the
        // configured cap is reached, stop this cursor instead of repeatedly
        // downloading pages that the store must discard.
        if (page.hasMore === false || merged.length >= MAX_CANDLES_PER_SERIES) {
          exhaustedOlderHistoryRef.current.add(cursorKey);
          return { status: "exhausted" };
        }
        return retry();
      }
      if (page.hasMore === false) {
        exhaustedOlderHistoryRef.current.add(`${symbol}:${timeframe}:${merged[0].time}`);
      }
      return { status: "loaded" };
    } catch (err) {
      if (isAbortError(err) || generation !== olderHistoryGenerationRef.current) {
        return retry();
      }
      const message = err instanceof Error ? err.message : String(err);
      store.set(logAtom, "warn", `Older history load failed for ${symbol} ${timeframe}: ${message}`);
      return retry();
    } finally {
      if (olderHistoryControllerRef.current === controller) {
        olderHistoryControllerRef.current = null;
        olderHistoryInFlightRef.current = false;
      }
    }
  }, [activeKey, enabled, historyReadyKey, symbol, timeframe]);

  const loadCandlesAroundTime = useCallback(
    async (time: number): Promise<LoadedGoToHistory> => {
      if (!enabled || historyReadyKey !== activeKey) {
        throw new Error("Chart history is not ready yet");
      }
      if (!symbol || !Number.isFinite(time) || time <= 0) {
        throw new Error("A valid symbol and date are required");
      }

      const result = await getHistoricalDataService().loadHistoryAround({
        symbol,
        timeframe,
        time,
        limit: historyPageBars(timeframe),
      });
      const marketData = getMarketDataState();
      marketData.setCandles(symbol, timeframe, result.candles);
      const merged = marketData.getCandles(symbol, timeframe) as Candle[];
      if (!merged.some((candle) => candle.time === result.resolvedTime)) {
        throw new Error("The selected candle could not be retained in the chart history window");
      }
      return {
        candles: merged,
        requestedTime: result.requestedTime,
        resolvedTime: result.resolvedTime,
      };
    },
    [activeKey, enabled, historyReadyKey, symbol, timeframe],
  );

  return { loadOlderCandles, loadCandlesAroundTime };
}
