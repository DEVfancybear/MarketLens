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
 *     `chartStore.candles`, so the rest of the app (chart, indicators, SMC,
 *     replay, trade) keeps reading `chartStore.candles` via `useVisibleCandles`
 *     unchanged — now fed by realtime data instead of the mock generator.
 *
 * No sockets are created here; the MarketDataService/providers own connections.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  symbolAtom,
  timeframeAtom,
  setCandlesAtom,
  setLoadingAtom,
} from "@/store/chartStore";
import {
  activeAtom,
  cursorTimeAtom,
  disarmAtom,
  reconcileReplayToCandlesAtom,
  setTotalAtom,
} from "@/store/replayStore";
import { getDefaultStore } from "jotai";
import { logAtom } from "@/store/uiStore";
import { getMarketDataState } from "@/store/marketDataStore";
import { useCandles } from "@/hooks/useCandles";
import { getMarketDataService } from "@/services/market-data/MarketDataService";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import { TF_SECONDS, type Candle, type Timeframe } from "@/types";
import { findRecentCandleGap } from "@/services/market-data/candleSeries";
import { getMarketSymbol } from "@/services/market-data/symbols";
import {
  marketSymbolCatalogStatusAtom,
  marketSymbolsAtom,
} from "@/store/marketSymbolStore";
import {
  HISTORY_SELECTION_DEBOUNCE_MS,
  historyPageBars,
  initialHistoryBars,
  mt5HistoryRefreshMs,
} from "@/services/market-data/historyPolicy";

const MAX_BACKFILL_MISSING_BARS = 50;

function mt5RefreshBarsForTimeframe(timeframe: Timeframe): number {
  if (timeframe === "1D" || timeframe === "1W" || timeframe === "1M") return 5;
  if (timeframe === "1H" || timeframe === "2H" || timeframe === "4H") return 10;
  return 20;
}

function replayHistoryBefore(
  timeframe: Timeframe,
  limit: number,
  cursorTime: number | null,
): number | undefined {
  if (cursorTime == null) return undefined;
  const step = TF_SECONDS[timeframe];
  const targetWindowEnd = cursorTime + Math.floor(limit * step * 0.7);
  const nearNow = Math.floor(Date.now() / 1000) + step;
  return targetWindowEnd < nearNow ? targetWindowEnd : undefined;
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === "AbortError";
  return (error as { name?: string }).name === "AbortError";
}

export function useMarketData() {
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const setCandles = useSetAtom(setCandlesAtom);
  const setLoading = useSetAtom(setLoadingAtom);
  const disarm = useSetAtom(disarmAtom);
  const setTotal = useSetAtom(setTotalAtom);
  const reconcileReplay = useSetAtom(reconcileReplayToCandlesAtom);
  const catalogStatus = useAtomValue(marketSymbolCatalogStatusAtom);
  const catalogSize = useAtomValue(marketSymbolsAtom).length;
  const backfilledGapsRef = useRef<Set<string>>(new Set());
  const olderHistoryInFlightRef = useRef(false);
  const exhaustedOlderHistoryRef = useRef<Set<string>>(new Set());
  const previousSymbolRef = useRef<string | null>(null);
  const activeKey = `${symbol}:${timeframe}`;
  const [historyReadyKey, setHistoryReadyKey] = useState<string | null>(null);

  // Realtime candle series from the store for the active symbol+timeframe.
  const liveCandles = useCandles(symbol, timeframe);

  useEffect(() => {
    olderHistoryInFlightRef.current = false;
    exhaustedOlderHistoryRef.current.clear();
  }, [activeKey]);

  // ---- Select market + load history on symbol/timeframe change ----
  useEffect(() => {
    let cancelled = false;
    const key = `${symbol}:${timeframe}`;
    const store = getDefaultStore();
    const previousSymbol = previousSymbolRef.current;
    const symbolChanged =
      previousSymbol !== null && previousSymbol !== symbol;
    previousSymbolRef.current = symbol;
    const replayActive = store.get(activeAtom);
    const replayCursorTime = store.get(cursorTimeAtom);
    setHistoryReadyKey(null);
    if (symbolChanged) {
      disarm();
    }

    const meta = symbol ? getMarketSymbol(symbol) : undefined;
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
      setTotal(0);
      setLoading(false);
      setHistoryReadyKey(key);
      return () => {
        cancelled = true;
      };
    }

    getMarketDataService(); // ensure the service exists + is bound to the store

    const marketData = getMarketDataState();
    const cached = marketData.getCandles(symbol, timeframe) as Candle[];
    const hasCachedHistory =
      cached.length > 0 && (!replayActive || replayCursorTime == null);
    if (hasCachedHistory) {
      // Timeframe caches remain in marketDataStore. Paint them synchronously and
      // revalidate in the background instead of covering the chart with a
      // spinner every time the user switches back to an already visited frame.
      marketData.selectMarket(symbol, timeframe);
      setCandles(cached);
      if (replayActive) {
        reconcileReplay(cached);
      } else {
        setTotal(cached.length);
      }
      setHistoryReadyKey(key);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const historyLimit = initialHistoryBars(timeframe);
    const controller = new AbortController();

    // Deferring one tick avoids React Strict Mode's mount/cleanup probe from
    // issuing a real HTTP request. It also collapses rapid timeframe clicks so
    // MT5 only receives work for the selection the user actually stopped on.
    const requestTimer = window.setTimeout(() => {
      getHistoricalDataService()
        .loadHistory({
          symbol,
          timeframe,
          limit: historyLimit,
          before:
            replayActive && !symbolChanged
              ? replayHistoryBefore(timeframe, historyLimit, replayCursorTime)
              : undefined,
          refresh: hasCachedHistory || undefined,
        }, {
          signal: controller.signal,
        })
        .then((hist) => {
          if (cancelled) return;
          // Seed history before subscribing. For MT5, candles must come from
          // MT5 rates/history; ticks are used only for quotes/watchlist.
          getMarketDataState().setCandles(symbol, timeframe, hist);
          getMarketDataState().selectMarket(symbol, timeframe);
          const nextCandles = getMarketDataState().getCandles(
            symbol,
            timeframe,
          ) as Candle[];
          setCandles(nextCandles);
          if (getDefaultStore().get(activeAtom)) {
            reconcileReplay(nextCandles);
          } else {
            setTotal(nextCandles.length);
          }
          setHistoryReadyKey(key);
          setLoading(false);
        })
        .catch((err) => {
          if (isAbortError(err)) return;
          if (cancelled) return;
          if (!hasCachedHistory) {
            getMarketDataState().setCandles(symbol, timeframe, []);
            setCandles([]);
            setTotal(0);
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
  }, [symbol, timeframe, catalogStatus, catalogSize]);

  // ---- Mirror store candles → chartStore (drives chart/SMC/replay/trade) ----
  useEffect(() => {
    if (historyReadyKey !== activeKey) return;
    const nextCandles = liveCandles as Candle[];
    setCandles(nextCandles);
    if (getDefaultStore().get(activeAtom)) {
      reconcileReplay(nextCandles);
    } else {
      setTotal(nextCandles.length);
    }
  }, [
    activeKey,
    historyReadyKey,
    liveCandles,
    reconcileReplay,
    setCandles,
    setTotal,
  ]);

  // ---- MT5 active-chart refresh: update OHLC from MT5 rates, not bid/ask ticks ----
  useEffect(() => {
    const meta = symbol ? getMarketSymbol(symbol) : undefined;
    if (!symbol || meta?.provider !== "mt5" || historyReadyKey !== activeKey) {
      return;
    }

    let cancelled = false;
    let inFlight = false;
    let activeController: AbortController | null = null;

    const refreshLatestBars = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      activeController = new AbortController();
      try {
        const hist = await getHistoricalDataService().loadHistory({
          symbol,
          timeframe,
          limit: mt5RefreshBarsForTimeframe(timeframe),
          refresh: true,
        }, {
          signal: activeController.signal,
        });
        if (cancelled) return;
        getMarketDataState().setCandles(symbol, timeframe, hist);
      } catch (err) {
        if (isAbortError(err)) return;
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        getDefaultStore().set(
          logAtom,
          "warn",
          `MT5 latest bars refresh failed for ${symbol} ${timeframe}: ${message}`,
        );
      } finally {
        activeController = null;
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshLatestBars();
      }
    }, mt5HistoryRefreshMs(timeframe));
    return () => {
      cancelled = true;
      activeController?.abort();
      window.clearInterval(timer);
    };
  }, [activeKey, historyReadyKey, symbol, timeframe]);

  // ---- Repair short realtime gaps without a full page refresh ----
  useEffect(() => {
    const meta = symbol ? getMarketSymbol(symbol) : undefined;
    if (!symbol || !meta || meta.provider === "mt5") return;

    const step = TF_SECONDS[timeframe];
    const gap = findRecentCandleGap(
      liveCandles,
      step,
      MAX_BACKFILL_MISSING_BARS,
    );
    if (!gap) return;

    const gapKey = `${symbol}:${timeframe}:${gap.afterTime}:${gap.beforeTime}`;
    if (backfilledGapsRef.current.has(gapKey)) return;
    backfilledGapsRef.current.add(gapKey);

    const limit = Math.min(Math.max(gap.missingBars + 4, 20), 200);
    getHistoricalDataService()
      .loadHistory({
        symbol,
        timeframe,
        limit,
        before: gap.beforeTime,
      })
      .then((hist) => {
        getMarketDataState().setCandles(symbol, timeframe, hist);
      })
      .catch((err) => {
        getDefaultStore().set(
          logAtom,
          "error",
          `Gap backfill failed for ${symbol} ${timeframe}: ${String(err?.message ?? err)}`,
        );
      });
  }, [liveCandles, symbol, timeframe]);

  const loadOlderCandles = useCallback(async () => {
    if (historyReadyKey !== activeKey) return;
    const store = getDefaultStore();
    if (store.get(activeAtom)) return;

    const current = getMarketDataState().getCandles(symbol, timeframe);
    const first = current[0];
    if (!symbol || !first || olderHistoryInFlightRef.current) return;

    const cursorKey = `${symbol}:${timeframe}:${first.time}`;
    if (exhaustedOlderHistoryRef.current.has(cursorKey)) return;

    olderHistoryInFlightRef.current = true;
    try {
      const older = await getHistoricalDataService().loadHistory({
        symbol,
        timeframe,
        limit: historyPageBars(timeframe),
        before: first.time,
      });
      if (older.length === 0 || older[0]?.time >= first.time) {
        exhaustedOlderHistoryRef.current.add(cursorKey);
        return;
      }
      getMarketDataState().setCandles(symbol, timeframe, older);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.set(
        logAtom,
        "warn",
        `Older history load failed for ${symbol} ${timeframe}: ${message}`,
      );
    } finally {
      olderHistoryInFlightRef.current = false;
    }
  }, [activeKey, historyReadyKey, symbol, timeframe]);

  return { loadOlderCandles };
}
