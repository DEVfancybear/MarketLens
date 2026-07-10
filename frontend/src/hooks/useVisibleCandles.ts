"use client";
import { useMemo, useSyncExternalStore } from "react";
import { useAtomValue } from "jotai";
import { candlesAtom } from "@/store/chartStore";
import { activeAtom, cursorAtom } from "@/store/replayStore";
import type { Candle } from "@/types";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";
import { replayClientStore } from "@/store/replayClientStore";

/**
 * The single source of truth for "what the user is allowed to see".
 *
 * With backend replay enabled, this returns only server-aggregated revealed
 * bars. The legacy slice remains the rollback path while the flag is off.
 */
export function useVisibleCandles(): Candle[] {
  const candles = useAtomValue(candlesAtom);
  const active = useAtomValue(activeAtom);
  const cursor = useAtomValue(cursorAtom);
  const projection = useSyncExternalStore(
    (listener) => replayClientStore.subscribe(listener),
    () => replayClientStore.getState(),
    () => replayClientStore.getState(),
  );

  return useMemo(() => {
    if (!active) return candles;
    if (isReplayBackendV1Enabled()) {
      const trackId = projection.snapshot?.tracks[0]?.id;
      if (!trackId) return [];
      return (projection.barsByTrack[trackId] ?? []).map((bar) => ({
        time: Math.floor(Date.parse(bar.time) / 1000),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      }));
    }
    return candles.slice(0, cursor + 1);
  }, [candles, active, cursor, projection]);
}
