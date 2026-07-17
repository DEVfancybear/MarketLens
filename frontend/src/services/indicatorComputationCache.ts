/**
 * Compatibility facade for chart virtualization.
 *
 * Calculation is never performed here. Built-ins are fetched from the Go
 * indicator runtime and custom scripts from the Go Pine runtime; this module
 * only selects the already-cached API result for the current candle window.
 */
import type { Candle, IndicatorConfig, IndicatorResult } from "@/types";
import type { PineCompileContext } from "@/services/pineRuntimeCache";
import { computeIndicator } from "@/services/indicators";
import { incrementChartPerformanceCounter } from "@/services/chartPerformanceProbe";
import { clearIndicatorRuntimeCache } from "@/services/indicatorRuntimeCache";

export function computeCachedIndicator(
  config: IndicatorConfig,
  candles: readonly Candle[],
  ctx?: PineCompileContext,
  _runtimeRevision = 0,
): IndicatorResult {
  incrementChartPerformanceCounter("indicator.cache.runtimeReads");
  return computeIndicator(config, candles as Candle[], ctx);
}

export function clearIndicatorComputationCache() {
  clearIndicatorRuntimeCache();
}
