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
import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  symbolAtom,
  timeframeAtom,
  setCandlesAtom,
  setLoadingAtom,
} from "@/store/chartStore";
import { disarmAtom, setTotalAtom } from "@/store/replayStore";
import { getDefaultStore } from "jotai";
import { logAtom } from "@/store/uiStore";
import { getMarketDataState } from "@/store/marketDataStore";
import { useCandles } from "@/hooks/useCandles";
import { getMarketDataService } from "@/services/market-data/MarketDataService";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import { TF_SECONDS, type Candle, type Timeframe } from "@/types";
import { findRecentCandleGap } from "@/services/market-data/candleSeries";
import { getMarketSymbol } from "@/services/market-data/symbols";

const DEFAULT_HISTORY_BARS = 1500;
const MAX_BACKFILL_MISSING_BARS = 50;

function historyBarsForTimeframe(timeframe: Timeframe): number {
  if (timeframe === "1H" || timeframe === "2H") return 3000;
  return DEFAULT_HISTORY_BARS;
}

export function useMarketData() {
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const setCandles = useSetAtom(setCandlesAtom);
  const setLoading = useSetAtom(setLoadingAtom);
  const disarm = useSetAtom(disarmAtom);
  const setTotal = useSetAtom(setTotalAtom);
  const backfilledGapsRef = useRef<Set<string>>(new Set());

  // Realtime candle series from the store for the active symbol+timeframe.
  const liveCandles = useCandles(symbol, timeframe);

  // ---- Select market + load history on symbol/timeframe change ----
  useEffect(() => {
    let cancelled = false;
    disarm(); // a new market invalidates any replay cursor

    const meta = symbol ? getMarketSymbol(symbol) : undefined;
    if (!symbol || !meta) {
      getMarketDataState().setCandles(symbol, timeframe, []);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    getMarketDataService(); // ensure the service exists + is bound to the store
    getMarketDataState().selectMarket(symbol, timeframe);

    setLoading(true);

    getHistoricalDataService()
      .loadHistory({
        symbol,
        timeframe,
        limit: historyBarsForTimeframe(timeframe),
      })
      .then((hist) => {
        if (cancelled) return;
        // Seed the store; realtime klines then merge onto this via updateCandle.
        getMarketDataState().setCandles(symbol, timeframe, hist);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
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
  }, [symbol, timeframe]);

  // ---- Mirror store candles → chartStore (drives chart/SMC/replay/trade) ----
  useEffect(() => {
    setCandles(liveCandles as Candle[]);
    setTotal(liveCandles.length);
  }, [liveCandles, setCandles, setTotal]);

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
