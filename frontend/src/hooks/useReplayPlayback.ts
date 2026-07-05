"use client";
import { useEffect, useRef } from "react";
import { getReplayState } from "@/store/replayStore";
import { speedToIntervalMs } from "@/services/replayEngine";

/**
 * Drives the replay clock. While `playing`, advances the cursor by one candle
 * every `speedToIntervalMs(speed)` using a self-correcting rAF loop (so high
 * speeds stay smooth and don't drift). Mount once near the app root.
 */
export function useReplayPlayback() {
  const accRef = useRef(0);
  const lastRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = (now: number) => {
      const { playing, speed, cursor, total, step, pause } = getReplayState();
      if (!playing) {
        lastRef.current = now;
        accRef.current = 0;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      if (lastRef.current == null) lastRef.current = now;
      const dt = now - lastRef.current;
      lastRef.current = now;
      accRef.current += dt;

      const interval = speedToIntervalMs(speed);
      let steps = 0;
      while (accRef.current >= interval && steps < 200) {
        accRef.current -= interval;
        steps++;
      }
      if (steps > 0) {
        if (cursor + steps >= total - 1) {
          step(total - 1 - cursor);
          pause();
        } else {
          step(steps);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastRef.current = null;
      accRef.current = 0;
    };
  }, []);
}
