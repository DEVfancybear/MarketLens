"use client";
import { useEffect } from "react";
import { useVisibleCandles } from "@/hooks/useVisibleCandles";
import { useAtomValue, useSetAtom } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { setTradeMarketAtom } from "@/store/tradeStore";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";
import { activeAtom } from "@/store/replayStore";

/**
 * Feeds only the normal live/simulator market loop. Backend-enabled replay is
 * deliberately excluded so its account and fills can never leak into the
 * normal simulator ledger.
 */
export function useTradeRuntime() {
  const candles = useVisibleCandles();
  const symbol = useAtomValue(symbolAtom);
  const replayActive = useAtomValue(activeAtom);
  const setMarket = useSetAtom(setTradeMarketAtom);

  useEffect(() => {
    if (isReplayBackendV1Enabled() && replayActive) {
      return;
    }
    const last = candles[candles.length - 1];
    if (last) setMarket({ symbol, candle: last });
  }, [candles, replayActive, symbol, setMarket]);
}
