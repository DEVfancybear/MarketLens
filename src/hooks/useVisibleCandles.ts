"use client";
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { activeAtom, cursorAtom } from "@/store/replayStore";
import type { Candle } from "@/types";

/**
 * The single source of truth for "what the user is allowed to see".
 *
 * When replay is armed, this returns only candles[0 .. cursor]. Every chart,
 * indicator and SMC overlay derives from this slice, which is how the platform
 * structurally guarantees no future-data leakage / look-ahead bias: future
 * candles simply do not exist downstream of this hook.
 */
export function useVisibleCandles(): Candle[] {
  const candles = useAtomValue(candlesAtom);
  const active = useAtomValue(activeAtom);
  const cursor = useAtomValue(cursorAtom);

  return useMemo(() => {
    if (!active) return candles;
    return candles.slice(0, cursor + 1);
  }, [candles, active, cursor]);
}
