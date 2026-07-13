"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { timeframeAtom, setTimeframeAtom } from "@/store/chartStore";
import type { Timeframe } from "@/types";
import { cn } from "@/utils/cn";

const MOBILE_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1H", "4H", "1D"];

export function MobileTimeframeBar() {
  const active = useAtomValue(timeframeAtom);
  const setTimeframe = useSetAtom(setTimeframeAtom);
  return (
    <div className="mobile-timeframes" aria-label="Chart interval">
      {MOBILE_TIMEFRAMES.map((item) => <button key={item} type="button" aria-pressed={active === item} onClick={() => setTimeframe(item)} className={cn(active === item && "is-active")}>{item}</button>)}
    </div>
  );
}
