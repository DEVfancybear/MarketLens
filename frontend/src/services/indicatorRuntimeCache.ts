import type { Candle, IndicatorConfig, IndicatorResult, Timeframe } from "@/types";
import { computeIndicatorRuntime } from "@/services/api/resources/indicatorRuntimeApi";
import { loadIndicatorDefinition } from "@/services/indicatorDefinitions";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import {
  indicatorRuntimeCacheKey,
  indicatorRuntimeScopeKey,
  type IndicatorRuntimeContext,
} from "@/services/indicatorRuntimePolicy";

type Listener = () => void;

const MAX_RUNTIME_CANDLES = 5_000;
const MAX_ENTRIES = 64;
const MAX_HISTORY_CONTEXT_ENTRIES = 24;
const FAILURE_RETRY_MS = 15_000;
const MAX_OBJECT_SEGMENTS_PER_HANDLE = 3;

const cache = new Map<string, IndicatorResult>();
const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const historyContextCache = new Map<string, Promise<Candle[]>>();
const latestByScope = new Map<string, IndicatorResult>();
const latestRequestByScope = new Map<string, string>();
const listeners = new Set<Listener>();
let generation = 0;

export type { IndicatorRuntimeContext } from "@/services/indicatorRuntimePolicy";

function notify() {
  for (const listener of listeners) listener();
}

function rememberFailure(cacheKey: string, requestGeneration: number) {
  const timestamp = Date.now();
  failedAt.delete(cacheKey);
  failedAt.set(cacheKey, timestamp);
  while (failedAt.size > MAX_ENTRIES) {
    const oldest = failedAt.keys().next().value as string | undefined;
    if (!oldest) break;
    failedAt.delete(oldest);
  }
  globalThis.setTimeout(() => {
    if (requestGeneration !== generation || failedAt.get(cacheKey) !== timestamp) return;
    failedAt.delete(cacheKey);
    notify();
  }, FAILURE_RETRY_MS);
}

function touchResult(target: Map<string, IndicatorResult>, key: string, result: IndicatorResult) {
  target.delete(key);
  target.set(key, result);
  while (target.size > MAX_ENTRIES) {
    const oldest = target.keys().next().value as string | undefined;
    if (!oldest) break;
    target.delete(oldest);
    if (target === latestByScope) latestRequestByScope.delete(oldest);
  }
}

function readResult(target: Map<string, IndicatorResult>, key: string): IndicatorResult | null {
  const result = target.get(key);
  if (!result) return null;
  target.delete(key);
  target.set(key, result);
  return result;
}

function runtimeCandles(candles: readonly Candle[]): Candle[] {
  return candles.length > MAX_RUNTIME_CANDLES
    ? [...candles.slice(-MAX_RUNTIME_CANDLES)]
    : [...candles];
}

function historyBarsForTimeframe(timeframe: Timeframe | undefined): number {
  switch (timeframe) {
    case "1m":
    case "3m":
    case "5m":
      return 5_000;
    case "15m":
      return 3_000;
    case "30m":
      return 2_000;
    case "1H":
    case "2H":
    case "4H":
      return 1_200;
    case "1D":
      return 600;
    case "1W":
      return 260;
    case "1M":
      return 120;
    default:
      return 1_500;
  }
}

function mergeCandles(left: readonly Candle[], right: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of left) byTime.set(candle.time, candle);
  for (const candle of right) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function objectSegmentParts(key: string): { handle: string; segment: number } | null {
  const match = key.match(/^(.+)_(\d+)$/);
  return match ? { handle: match[1], segment: Number(match[2]) } : null;
}

function recentObjectSegmentFloor(items: Array<{ key: string }>): Record<string, number> {
  const byHandle = new Map<string, Set<number>>();
  for (const item of items) {
    const parsed = objectSegmentParts(item.key);
    if (!parsed || !Number.isFinite(parsed.segment)) continue;
    const segments = byHandle.get(parsed.handle) ?? new Set<number>();
    segments.add(parsed.segment);
    byHandle.set(parsed.handle, segments);
  }
  const floors: Record<string, number> = {};
  for (const [handle, segments] of byHandle) {
    const sorted = [...segments].sort((a, b) => a - b);
    if (sorted.length > MAX_OBJECT_SEGMENTS_PER_HANDLE) {
      floors[handle] = sorted[sorted.length - MAX_OBJECT_SEGMENTS_PER_HANDLE];
    }
  }
  return floors;
}

function limitObjectSegments(result: IndicatorResult): IndicatorResult {
  const floors = recentObjectSegmentFloor([...result.series, ...(result.labels ?? [])]);
  if (Object.keys(floors).length === 0) return result;
  const keep = (key: string) => {
    const parsed = objectSegmentParts(key);
    return !parsed || floors[parsed.handle] == null || parsed.segment >= floors[parsed.handle];
  };
  return {
    ...result,
    series: result.series.filter((series) => keep(series.key)),
    labels: result.labels?.filter((label) => keep(label.key)),
  };
}

async function loadHistoryContext(
  context: IndicatorRuntimeContext,
  limit: number,
): Promise<Candle[]> {
  if (!context.symbol || !context.timeframe) return [];
  const key = `${context.symbol}:${context.timeframe}:${limit}`;
  let promise = historyContextCache.get(key);
  if (!promise) {
    promise = getHistoricalDataService()
      .loadHistory({ symbol: context.symbol, timeframe: context.timeframe, limit })
      .catch((error) => {
        if (historyContextCache.get(key) === promise) historyContextCache.delete(key);
        throw error;
      });
    historyContextCache.set(key, promise);
    while (historyContextCache.size > MAX_HISTORY_CONTEXT_ENTRIES) {
      const oldest = historyContextCache.keys().next().value as string | undefined;
      if (!oldest) break;
      historyContextCache.delete(oldest);
    }
  } else {
    historyContextCache.delete(key);
    historyContextCache.set(key, promise);
  }
  return promise;
}

async function requiresHistoryContext(config: IndicatorConfig): Promise<boolean> {
  if (config.requiresHistoryContext != null) return config.requiresHistoryContext;
  try {
    const definition = await loadIndicatorDefinition({
      indicatorType: config.type,
      sourceCode: config.sourceCode,
    });
    return definition.requiresHistoryContext;
  } catch {
    return false;
  }
}

async function resolveRuntimeCandles(
  config: IndicatorConfig,
  candles: readonly Candle[],
  context?: IndicatorRuntimeContext,
): Promise<Candle[]> {
  if (!(await requiresHistoryContext(config)) || !context?.symbol || !context.timeframe) {
    return [...candles];
  }
  const targetBars = historyBarsForTimeframe(context.timeframe);
  if (candles.length >= targetBars) return [...candles];
  try {
    return mergeCandles(await loadHistoryContext(context, targetBars), candles);
  } catch {
    return [...candles];
  }
}

export function subscribeIndicatorRuntimeCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedIndicatorRuntimeResult(
  config: IndicatorConfig,
  candles: readonly Candle[],
  context?: IndicatorRuntimeContext,
): IndicatorResult | null {
  return (
    readResult(cache, indicatorRuntimeCacheKey(config, candles, context)) ??
    readResult(latestByScope, indicatorRuntimeScopeKey(config, context)) ??
    null
  );
}

export function computeIndicator(
  config: IndicatorConfig,
  candles: readonly Candle[],
  context?: IndicatorRuntimeContext,
): IndicatorResult {
  return getCachedIndicatorRuntimeResult(config, candles, context) ?? {
    id: config.id,
    series: [],
  };
}

export function ensureIndicatorRuntimeResult(
  config: IndicatorConfig,
  candles: readonly Candle[],
  context?: IndicatorRuntimeContext,
): void {
  if (candles.length === 0) return;
  const runtimeKey = indicatorRuntimeCacheKey(config, candles, context);
  if (cache.has(runtimeKey) || inflight.has(runtimeKey)) return;
  const lastFailure = failedAt.get(runtimeKey);
  if (lastFailure != null && Date.now() - lastFailure < FAILURE_RETRY_MS) return;
  failedAt.delete(runtimeKey);

  const scope = indicatorRuntimeScopeKey(config, context);
  const requestGeneration = generation;
  latestRequestByScope.set(scope, runtimeKey);
  let promise: Promise<void>;
  promise = resolveRuntimeCandles(config, candles, context)
    .then((resolved) => computeIndicatorRuntime(config, runtimeCandles(resolved), context))
    .then((response) => {
      if (requestGeneration !== generation) return;
      if (response.errors.length === 0) {
        const result = limitObjectSegments(response.result);
        failedAt.delete(runtimeKey);
        touchResult(cache, runtimeKey, result);
        if (latestRequestByScope.get(scope) === runtimeKey) {
          touchResult(latestByScope, scope, result);
        }
      } else {
        rememberFailure(runtimeKey, requestGeneration);
      }
    })
    .catch(() => {
      if (requestGeneration === generation) rememberFailure(runtimeKey, requestGeneration);
    })
    .finally(() => {
      if (inflight.get(runtimeKey) === promise) inflight.delete(runtimeKey);
      if (requestGeneration === generation) notify();
    });
  inflight.set(runtimeKey, promise);
}

export function clearIndicatorRuntimeCache() {
  generation += 1;
  cache.clear();
  inflight.clear();
  failedAt.clear();
  historyContextCache.clear();
  latestByScope.clear();
  latestRequestByScope.clear();
  notify();
}
