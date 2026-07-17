/**
 * Compatibility facade for chart virtualization.
 *
 * Calculation is never performed here. Every indicator is fetched from the
 * common Go runtime; this module only reads the current cached result.
 */
import type { Candle, IndicatorConfig, IndicatorResult } from "@/types";
import type { IndicatorRuntimeContext } from "@/services/indicatorRuntimeCache";
import { computeIndicator } from "@/services/indicatorRuntimeCache";
import { incrementChartPerformanceCounter } from "@/services/chartPerformanceProbe";
import { clearIndicatorRuntimeCache } from "@/services/indicatorRuntimeCache";

export function computeCachedIndicator(
  config: IndicatorConfig,
  candles: readonly Candle[],
  ctx?: IndicatorRuntimeContext,
  _runtimeRevision = 0,
): IndicatorResult {
  incrementChartPerformanceCounter("indicator.cache.runtimeReads");
  return computeIndicator(config, candles as Candle[], ctx);
}

export function clearIndicatorComputationCache() {
  clearIndicatorRuntimeCache();
}
