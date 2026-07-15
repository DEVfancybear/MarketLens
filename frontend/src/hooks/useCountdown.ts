"use client";
import { useEffect, useState } from "react";
import { secondsUntilBarClose } from "@/components/chart/countdownModel";
import { formatCountdown } from "@/components/chart/countdownPresentation";
import type { Timeframe } from "@/types";

/**
 * TradingView-style countdown anchored to the current candle's UTC open time.
 * The source anchor keeps broker-defined daily and weekly sessions aligned,
 * while the countdown model handles monthly bars as calendar months.
 */
export function useCountdown(tf: Timeframe, barOpenTime?: number | null): string {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      setRemaining(secondsUntilBarClose(tf, Date.now() / 1000, barOpenTime));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [barOpenTime, tf]);

  return formatCountdown(remaining);
}
