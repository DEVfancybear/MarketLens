'use client';
import { useEffect, useState } from 'react';
import { TF_SECONDS, type Timeframe } from '@/types';

/** TradingView-style countdown timer until the next bar closes. */
export function useCountdown(tf: Timeframe): string {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const sec = TF_SECONDS[tf];
    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      setRemaining(sec - (now % sec));
    };
    tick();
    const id = setInterval(tick, 250); // tick 4×/s for smooth countdown
    return () => clearInterval(id);
  }, [tf]);

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `0:${String(s).padStart(2, '0')}`;
}
