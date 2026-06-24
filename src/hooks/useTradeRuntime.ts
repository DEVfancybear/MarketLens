'use client';
import { useEffect } from 'react';
import { useVisibleCandles } from '@/hooks/useVisibleCandles';
import { useChartStore } from '@/store/chartStore';
import { useTradeStore } from '@/store/tradeStore';

/**
 * Streams the most recently revealed candle into the trade simulator so pending
 * orders fill and stops/targets trigger in lock-step with replay. Because it
 * uses the replay-aware visible slice, simulated fills can never see the future.
 */
export function useTradeRuntime() {
  const candles = useVisibleCandles();
  const symbol = useChartStore((s) => s.symbol);
  const setMarket = useTradeStore((s) => s.setMarket);

  useEffect(() => {
    const last = candles[candles.length - 1];
    if (last) setMarket(symbol, last);
  }, [candles, symbol, setMarket]);
}
