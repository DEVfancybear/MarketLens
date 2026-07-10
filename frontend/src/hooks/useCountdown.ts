"use client";
import { useEffect, useState } from "react";
import { TF_SECONDS, type Timeframe } from "@/types";
import { formatCountdown } from "@/components/chart/countdownPresentation";

/**
 * TradingView-style countdown timer.
 * - Sub-hour TFs (1m–30m): MM:SS
 * - 1H:                 MM:SS (up to 59:59)
 * - 4H+:                HH:MM:SS
 * - 1D+:                HH:MM:SS
 * - 1W:                 HH:MM:SS
 *
 * Updates every 250ms for smooth second-level rendering. Does not depend on
 * price feed — pure wall-clock.
 */
export function useCountdown(tf: Timeframe): string {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const sec = TF_SECONDS[tf];
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setRemaining(sec - (now % sec));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [tf]);

  return formatCountdown(remaining);
}
