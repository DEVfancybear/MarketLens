'use client';
import { useMemo } from 'react';
import { useChartStore } from '@/store/chartStore';
import { useReplayStore } from '@/store/replayStore';
import type { Candle } from '@/types';

/**
 * The single source of truth for "what the user is allowed to see".
 *
 * When replay is armed, this returns only candles[0 .. cursor]. Every chart,
 * indicator and SMC overlay derives from this slice, which is how the platform
 * structurally guarantees no future-data leakage / look-ahead bias: future
 * candles simply do not exist downstream of this hook.
 */
export function useVisibleCandles(): Candle[] {
  const candles = useChartStore((s) => s.candles);
  const active = useReplayStore((s) => s.active);
  const cursor = useReplayStore((s) => s.cursor);

  return useMemo(() => {
    if (!active) return candles;
    return candles.slice(0, cursor + 1);
  }, [candles, active, cursor]);
}
