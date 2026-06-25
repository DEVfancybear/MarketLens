'use client';
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
import { useEffect } from 'react';
import { useChartStore } from '@/store/chartStore';
import { useReplayStore } from '@/store/replayStore';
import { useUIStore } from '@/store/uiStore';
import { useMarketDataStore } from '@/store/marketDataStore';
import { useCandles } from '@/hooks/useCandles';
import { getMarketDataService } from '@/services/market-data/MarketDataService';
import { getHistoricalDataService } from '@/services/market-data/HistoricalDataService';
import type { Candle } from '@/types';

const HISTORY_BARS = 1500;

export function useMarketData() {
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const setCandles = useChartStore((s) => s.setCandles);
  const setLoading = useChartStore((s) => s.setLoading);
  const disarm = useReplayStore((s) => s.disarm);
  const setTotal = useReplayStore((s) => s.setTotal);

  // Realtime candle series from the store for the active symbol+timeframe.
  const liveCandles = useCandles(symbol, timeframe);

  // ---- Select market + load history on symbol/timeframe change ----
  useEffect(() => {
    let cancelled = false;
    getMarketDataService(); // ensure the service exists + is bound to the store
    useMarketDataStore.getState().selectMarket(symbol, timeframe);
    disarm(); // a new market invalidates any replay cursor
    setLoading(true);

    getHistoricalDataService()
      .loadHistory({ symbol, timeframe, limit: HISTORY_BARS })
      .then((hist) => {
        if (cancelled) return;
        // Seed the store; realtime klines then merge onto this via updateCandle.
        useMarketDataStore.getState().setCandles(symbol, timeframe, hist);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        useUIStore.getState().log('error', `History load failed for ${symbol} ${timeframe}: ${String(err?.message ?? err)}`);
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
}
