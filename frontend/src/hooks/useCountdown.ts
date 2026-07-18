"use client";
import { useEffect, useState } from "react";
import { nextBarCloseTime } from "@/components/chart/countdownModel";
import { formatCountdown } from "@/components/chart/countdownPresentation";
import { countdownClockNow } from "@/services/market-data/mt5SessionStatus";
import type { MarketSessionStatus, Timeframe } from "@/types";

/**
 * TradingView-style countdown anchored to the current candle's UTC open time.
 * The source anchor keeps broker-defined daily and weekly sessions aligned,
 * while the countdown model handles monthly bars as calendar months.
 */
export function useCountdown(
  tf: Timeframe,
  barOpenTime?: number | null,
  sessionStatus?: MarketSessionStatus | null,
): string | null {
  const [countdown, setCountdown] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = countdownClockNow(sessionStatus, Date.now() / 1000);
      if (now == null) {
        setCountdown(null);
        return;
      }
      const boundary = nextBarCloseTime(tf, now, barOpenTime);
      setCountdown(boundary == null ? null : formatCountdown(Math.ceil(boundary - now)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [barOpenTime, sessionStatus, tf]);

  return countdown;
}
