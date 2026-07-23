"use client";

import { useMemo, useRef } from "react";
import { useAtomValue } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { activeChartSlotAtom } from "@/store/replayLayoutStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  createReplayCandleProjector,
  type ReplayCandleProjector,
} from "@/components/chart/replayCandlePresentation";
import type { Candle } from "@/types";

/**
 * Live candles, or the authoritative server-revealed Replay projection for a
 * concrete chart slot. A chart without a Replay track deliberately remains on
 * live data (the TradingView "Current chart" behavior).
 */
export function useChartSeries(
  slot = 0,
  liveCandlesOverride?: Candle[],
): Candle[] {
  const storedLiveCandles = useAtomValue(candlesAtom);
  const activeSlot = useAtomValue(activeChartSlotAtom);
  const liveCandles = liveCandlesOverride ?? storedLiveCandles;
  const projection = useReplayClientProjection();
  const projectorRef = useRef<ReplayCandleProjector | null>(null);
  projectorRef.current ??= createReplayCandleProjector();
  const trackId = projection.snapshot?.mode === "single_chart"
    ? slot === activeSlot
      ? projection.snapshot.tracks[0]?.id
      : undefined
    : projection.snapshot?.tracks.find((track) => track.slot === slot)?.id;
  const replayBars = trackId ? projection.barsByTrack[trackId] : undefined;

  return useMemo(() => {
    if (!trackId) return liveCandles;
    return (replayBars ?? []).map(projectorRef.current!);
  }, [liveCandles, replayBars, trackId]);
}
