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
import { useEffect, useRef, useState } from "react";
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

const DEFAULT_HISTORY_BARS = 1500;
const MAX_BACKFILL_MISSING_BARS = 50;
const MT5_HISTORY_REFRESH_MS = 3000;

function historyBarsForTimeframe(timeframe: Timeframe): number {
  if (timeframe === "1H" || timeframe === "2H") return 3000;
  return DEFAULT_HISTORY_BARS;
}

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
  const previousSymbolRef = useRef<string | null>(null);
  const activeKey = `${symbol}:${timeframe}`;
  const [historyReadyKey, setHistoryReadyKey] = useState<string | null>(null);

  // Realtime candle series from the store for the active symbol+timeframe.
  const liveCandles = useCandles(symbol, timeframe);

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

    setLoading(true);

    const historyLimit = historyBarsForTimeframe(timeframe);

    getHistoricalDataService()
      .loadHistory({
        symbol,
        timeframe,
        limit: historyLimit,
        before:
          replayActive && !symbolChanged
            ? replayHistoryBefore(timeframe, historyLimit, replayCursorTime)
            : undefined,
      })
      .then((hist) => {
        if (cancelled) return;
        // Seed history before subscribing. For MT5, candles must come from
        // MT5 rates/history; ticks are used only for quotes/watchlist.
        getMarketDataState().setCandles(symbol, timeframe, hist);
        getMarketDataState().selectMarket(symbol, timeframe);
        const nextCandles = hist as Candle[];
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
        if (cancelled) return;
        getMarketDataState().setCandles(symbol, timeframe, []);
        setCandles([]);
        setTotal(0);
        setLoading(false);
        getDefaultStore().set(
          logAtom,
          "error",
          `History load failed for ${symbol} ${timeframe}: ${String(err?.message ?? err)}`,
        );
      });

    return () => {
      cancelled = true;
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

    const refreshLatestBars = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const hist = await getHistoricalDataService().loadHistory({
          symbol,
          timeframe,
          limit: mt5RefreshBarsForTimeframe(timeframe),
          refresh: true,
        });
        if (cancelled) return;
        getMarketDataState().setCandles(symbol, timeframe, hist);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        getDefaultStore().set(
          logAtom,
          "warn",
          `MT5 latest bars refresh failed for ${symbol} ${timeframe}: ${message}`,
        );
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(refreshLatestBars, MT5_HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
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
}
