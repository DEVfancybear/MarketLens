"use client";
import { useEffect, useState } from "react";
import { TF_SECONDS, type Timeframe } from "@/types";

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

  if (remaining <= 0) return "0:00";

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  // Sub-hour: MM:SS
  if (h === 0) return `${m}:${pad(s)}`;

  // 1H+: HH:MM:SS
  return `${h}:${pad(m)}:${pad(s)}`;
}
