import type { MarketCandle } from "@/types";
import {
  incrementChartPerformanceCounter,
  measureChartPerformance,
} from "@/services/chartPerformanceProbe";
import {
  mergeHistoryWithLiveCandles,
  normalizeMarketCandleSeries,
  upsertMarketCandleIntoSeries,
} from "./candleSeries";
import {
  createCandleRepository,
  materializeCandleRepository,
  mergeHistoryIntoCandleRepository,
  upsertCandleRepository,
} from "./candleRepository";

function sharedReferences(
  previous: readonly MarketCandle[],
  next: readonly MarketCandle[],
) {
  const previousItems = new Set(previous);
  return next.reduce((count, candle) => count + Number(previousItems.has(candle)), 0);
}

function sharedChunks<T>(previous: readonly T[], next: readonly T[]) {
  const previousItems = new Set(previous);
  return next.reduce((count, chunk) => count + Number(previousItems.has(chunk)), 0);
}

/** Development-only apples-to-apples legacy-array vs chunk-repository workload. */
export function runCandleRepositoryBenchmark(candles: readonly MarketCandle[]) {
  if (candles.length < 2) return;
  const initialBars = Math.min(900, candles.length);
  const targetLength = candles.length;
  const initial = candles.slice(candles.length - initialBars);
  let repository = createCandleRepository(initial, targetLength);
  let repositoryFlat = materializeCandleRepository(repository);
  let legacy = normalizeMarketCandleSeries(initial, targetLength);
  const remaining = candles.length - initialBars;
  const pageSize = Math.max(1, Math.ceil(remaining / 10));
  let cursor = remaining;

  while (cursor > 0) {
    const from = Math.max(0, cursor - pageSize);
    const history = candles.slice(from, cursor);
    const previousRepository = repository;
    const previousFlat = repositoryFlat;
    const previousLegacy = legacy;
    repository = measureChartPerformance(
      "candle.repository.benchmark.prepend",
      () => mergeHistoryIntoCandleRepository(repository, history, targetLength),
      { historyCandles: history.length, existingCandles: repository.length },
    );
    repositoryFlat = measureChartPerformance(
      "candle.repository.benchmark.materialize",
      () => materializeCandleRepository(repository),
      { candles: repository.length, chunks: repository.chunks.length },
    );
    legacy = measureChartPerformance(
      "candle.legacy.benchmark.prepend",
      () => mergeHistoryWithLiveCandles(history, legacy, targetLength),
      { historyCandles: history.length, existingCandles: legacy.length },
    );
    incrementChartPerformanceCounter("benchmark.repository.prepends");
    incrementChartPerformanceCounter(
      "benchmark.repository.candleReferencesReused",
      sharedReferences(previousFlat, repositoryFlat),
    );
    incrementChartPerformanceCounter(
      "benchmark.legacy.candleReferencesReused",
      sharedReferences(previousLegacy, legacy),
    );
    incrementChartPerformanceCounter(
      "benchmark.repository.chunksReused",
      sharedChunks(previousRepository.chunks, repository.chunks),
    );
    cursor = from;
  }

  const correctionCount = Math.min(10, repository.length);
  for (let correction = 0; correction < correctionCount; correction += 1) {
    const index = Math.floor(((correction + 1) * repository.length) / (correctionCount + 1));
    const existing = repositoryFlat[index];
    const corrected = { ...existing, close: existing.close + 0.001 * (correction + 1) };
    const previousRepository = repository;
    const previousFlat = repositoryFlat;
    const previousLegacy = legacy;
    repository = measureChartPerformance(
      "candle.repository.benchmark.correction",
      () => upsertCandleRepository(repository, corrected, targetLength),
      { candles: repository.length, index },
    );
    repositoryFlat = measureChartPerformance(
      "candle.repository.benchmark.materialize",
      () => materializeCandleRepository(repository),
      { candles: repository.length, chunks: repository.chunks.length },
    );
    legacy = measureChartPerformance(
      "candle.legacy.benchmark.correction",
      () => upsertMarketCandleIntoSeries(legacy, corrected, targetLength),
      { candles: legacy.length, index },
    );
    incrementChartPerformanceCounter("benchmark.repository.corrections");
    incrementChartPerformanceCounter(
      "benchmark.repository.candleReferencesReused",
      sharedReferences(previousFlat, repositoryFlat),
    );
    incrementChartPerformanceCounter(
      "benchmark.legacy.candleReferencesReused",
      sharedReferences(previousLegacy, legacy),
    );
    incrementChartPerformanceCounter(
      "benchmark.repository.chunksReused",
      sharedChunks(previousRepository.chunks, repository.chunks),
    );
  }

  incrementChartPerformanceCounter("benchmark.repository.finalCandles", repository.length);
  incrementChartPerformanceCounter("benchmark.repository.finalChunks", repository.chunks.length);
}
