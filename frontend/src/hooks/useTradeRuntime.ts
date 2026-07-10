"use client";
import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { candlesAtom, symbolAtom } from "@/store/chartStore";
import { setTradeMarketAtom } from "@/store/tradeStore";
import { useReplayClientProjection } from "@/store/replayClientStore";

/**
 * Feeds only the normal live/simulator market loop. Backend-enabled replay is
 * deliberately excluded so its account and fills can never leak into the
 * normal simulator ledger.
 */
export function useTradeRuntime() {
  const candles = useAtomValue(candlesAtom);
  const symbol = useAtomValue(symbolAtom);
  const replay = useReplayClientProjection();
  const setMarket = useSetAtom(setTradeMarketAtom);

  useEffect(() => {
    if (replay.snapshot) return;
    const last = candles[candles.length - 1];
    if (last) setMarket({ symbol, candle: last });
  }, [candles, replay.snapshot, symbol, setMarket]);
}
