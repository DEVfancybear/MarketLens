import type { Candle } from "@/types";

export const SMC_INPUT_MAX_BARS = 1_500;

/** Matches the SMC engine's bounded analysis domain before worker cloning. */
export function selectSmcInputWindow(
  candles: readonly Candle[],
  maxBars = SMC_INPUT_MAX_BARS,
): Candle[] {
  if (candles.length <= maxBars) return candles as Candle[];
  return candles.slice(-maxBars);
}
