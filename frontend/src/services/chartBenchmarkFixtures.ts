import type { Candle, IndicatorConfig } from "@/types";
import type { IndicatorRuntimeDefinition } from "@/services/api/resources/indicatorRuntimeApi";
import { indicatorConfigFromDefinition } from "./indicatorDefinitionModel";

export const CHART_BENCHMARK_SIZES = [900, 5_000, 20_000, 100_000] as const;
export type ChartBenchmarkSize = (typeof CHART_BENCHMARK_SIZES)[number];

let activeBenchmarkCandles: Candle[] | null = null;
const activeBenchmarkListeners = new Set<() => void>();

export function getActiveChartBenchmarkCandles() {
  return activeBenchmarkCandles;
}

export function setActiveChartBenchmarkCandles(candles: Candle[] | null) {
  activeBenchmarkCandles = candles;
  activeBenchmarkListeners.forEach((listener) => listener());
}

export function subscribeActiveChartBenchmarkCandles(listener: () => void) {
  activeBenchmarkListeners.add(listener);
  return () => {
    activeBenchmarkListeners.delete(listener);
  };
}

export function isChartBenchmarkSize(value: number): value is ChartBenchmarkSize {
  return CHART_BENCHMARK_SIZES.includes(value as ChartBenchmarkSize);
}

/** Stable catalog workload for measuring Phase 2 independently of user state. */
export function createPhase2BenchmarkIndicators(
  definitions: readonly IndicatorRuntimeDefinition[],
): IndicatorConfig[] {
  return definitions.slice(0, 5).map((definition, index) =>
    indicatorConfigFromDefinition(definition, `benchmark-indicator-${index}`),
  );
}

/** Deterministic, gap-aware OHLCV fixture. Same seed and size always match. */
export function createChartBenchmarkCandles(
  count: ChartBenchmarkSize,
  seed = 0x5eedc0de,
): Candle[] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const candles: Candle[] = [];
  let price = 100;
  let time = 1_704_067_200;
  for (let index = 0; index < count; index += 1) {
    // Insert a deterministic weekend-like gap every 2,000 bars.
    if (index > 0 && index % 2_000 === 0) time += 60 * 60 * 48;
    const open = price;
    const drift = Math.sin(index / 137) * 0.035;
    const close = Math.max(1, open + drift + (random() - 0.5) * 0.8);
    const wick = 0.05 + random() * 0.35;
    candles.push({
      time,
      open,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick * (0.75 + random() * 0.5),
      close,
      volume: 100 + Math.floor(random() * 9_900),
    });
    price = close;
    time += 60;
  }
  return candles;
}
