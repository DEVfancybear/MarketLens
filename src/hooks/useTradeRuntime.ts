"use client";
import { useEffect } from "react";
import { useVisibleCandles } from "@/hooks/useVisibleCandles";
import { useAtomValue, useSetAtom } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { setTradeMarketAtom } from "@/store/tradeStore";

/**
 * Streams the most recently revealed candle into the trade simulator so pending
 * orders fill and stops/targets trigger in lock-step with replay. Because it
 * uses the replay-aware visible slice, simulated fills can never see the future.
 */
export function useTradeRuntime() {
  const candles = useVisibleCandles();
  const symbol = useAtomValue(symbolAtom);
  const setMarket = useSetAtom(setTradeMarketAtom);

  useEffect(() => {
    const last = candles[candles.length - 1];
    if (last) setMarket({ symbol, candle: last });
  }, [candles, symbol, setMarket]);
}
