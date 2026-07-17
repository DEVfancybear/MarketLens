import type { Candle, IndicatorConfig, IndicatorResult, Timeframe } from "@/types";
import { compilePineRuntime } from "@/services/api/resources/pineRuntimeApi";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import {
  needsHigherTimeframeContext,
  pineIndicatorScopeKey,
  pineRuntimeCacheKey,
  type PineCompileContext,
} from "@/services/pineRuntimeCachePolicy";

type Listener = () => void;

const MAX_RUNTIME_CANDLES = 5_000;
const MAX_ENTRIES = 64;
const MAX_HISTORY_CONTEXT_ENTRIES = 24;
const FAILURE_RETRY_MS = 15_000;
const cache = new Map<string, IndicatorResult>();
const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const listeners = new Set<Listener>();
const historyContextCache = new Map<string, Promise<Candle[]>>();
const latestByScope = new Map<string, IndicatorResult>();
const latestRequestByScope = new Map<string, string>();
const MAX_OBJECT_SEGMENTS_PER_HANDLE = 3;
let generation = 0;

export type { PineCompileContext } from "@/services/pineRuntimeCachePolicy";

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
  window.setTimeout(() => {
    if (requestGeneration !== generation || failedAt.get(cacheKey) !== timestamp) return;
    failedAt.delete(cacheKey);
    notify();
  }, FAILURE_RETRY_MS);
}

function touchResult(
  target: Map<string, IndicatorResult>,
  key: string,
  result: IndicatorResult,
) {
  target.delete(key);
  target.set(key, result);
  while (target.size > MAX_ENTRIES) {
    const oldest = target.keys().next().value as string | undefined;
    if (!oldest) break;
    target.delete(oldest);
    if (target === latestByScope) latestRequestByScope.delete(oldest);
  }
}

function readResult(
  target: Map<string, IndicatorResult>,
  key: string,
): IndicatorResult | null {
  const result = target.get(key);
  if (!result) return null;
  target.delete(key);
  target.set(key, result);
  return result;
}

function runtimeCandles(candles: Candle[]): Candle[] {
  return candles.length > MAX_RUNTIME_CANDLES
    ? candles.slice(-MAX_RUNTIME_CANDLES)
    : candles;
}

function pineContextBarsForTimeframe(timeframe: Timeframe | undefined): number {
  switch (timeframe) {
    case "1m":
    case "3m":
    case "5m":
      return 5000;
    case "15m":
      return 3000;
    case "30m":
      return 2000;
    case "1H":
    case "2H":
    case "4H":
      return 1200;
    case "1D":
      return 600;
    case "1W":
      return 260;
    case "1M":
      return 120;
    default:
      return 1500;
  }
}

function mergeCandles(a: Candle[], b: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of a) byTime.set(candle.time, candle);
  for (const candle of b) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

function objectSegmentParts(key: string): { handle: string; segment: number } | null {
  const match = key.match(/^(.+)_(\d+)$/);
  if (!match) return null;
  return { handle: match[1], segment: Number(match[2]) };
}

function recentObjectSegmentFloor(
  items: Array<{ key: string }>,
): Record<string, number> {
  const byHandle = new Map<string, Set<number>>();
  for (const item of items) {
    const parsed = objectSegmentParts(item.key);
    if (!parsed || !Number.isFinite(parsed.segment)) continue;
    const set = byHandle.get(parsed.handle) ?? new Set<number>();
    set.add(parsed.segment);
    byHandle.set(parsed.handle, set);
  }

  const floors: Record<string, number> = {};
  for (const [handle, segments] of byHandle) {
    const sorted = [...segments].sort((a, b) => a - b);
    if (sorted.length <= MAX_OBJECT_SEGMENTS_PER_HANDLE) continue;
    floors[handle] = sorted[sorted.length - MAX_OBJECT_SEGMENTS_PER_HANDLE];
  }
  return floors;
}

function keepRecentObjectSegment(key: string, floors: Record<string, number>): boolean {
  const parsed = objectSegmentParts(key);
  if (!parsed) return true;
  const floor = floors[parsed.handle];
  return floor == null || parsed.segment >= floor;
}

function limitObjectSegments(result: IndicatorResult): IndicatorResult {
  const floors = recentObjectSegmentFloor([
    ...result.series,
    ...(result.labels ?? []),
  ]);
  if (Object.keys(floors).length === 0) return result;
  return {
    ...result,
    series: result.series.filter((series) =>
      keepRecentObjectSegment(series.key, floors),
    ),
    labels: result.labels?.filter((label) =>
      keepRecentObjectSegment(label.key, floors),
    ),
  };
}

async function loadPineHistoryContext(
  ctx: PineCompileContext,
  limit: number,
): Promise<Candle[]> {
  if (!ctx.symbol || !ctx.timeframe) return [];
  const key = `${ctx.symbol}:${ctx.timeframe}:${limit}`;
  let promise = historyContextCache.get(key);
  if (!promise) {
    promise = getHistoricalDataService()
      .loadHistory({
        symbol: ctx.symbol,
        timeframe: ctx.timeframe,
        limit,
      })
      .catch((error) => {
        if (historyContextCache.get(key) === promise) {
          historyContextCache.delete(key);
        }
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

async function resolveCompileCandles(
  cfg: IndicatorConfig,
  candles: Candle[],
  ctx?: PineCompileContext,
): Promise<Candle[]> {
  if (!needsHigherTimeframeContext(cfg.sourceCode) || !ctx?.symbol || !ctx.timeframe) {
    return candles;
  }
  const targetBars = pineContextBarsForTimeframe(ctx.timeframe);
  if (candles.length >= targetBars) return candles;
  try {
    const history = await loadPineHistoryContext(ctx, targetBars);
    return mergeCandles(history, candles);
  } catch {
    return candles;
  }
}

export function subscribePineRuntimeCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedPineIndicatorResult(
  cfg: IndicatorConfig,
  candles: Candle[],
  ctx?: PineCompileContext,
): IndicatorResult | null {
  if (cfg.type !== "CUSTOM" || !cfg.sourceCode?.trim()) {
    return { id: cfg.id, series: [] };
  }
  return (
    readResult(cache, pineRuntimeCacheKey(cfg, candles, ctx)) ??
    readResult(latestByScope, pineIndicatorScopeKey(cfg, ctx)) ??
    null
  );
}

export function ensurePineIndicatorResult(
  cfg: IndicatorConfig,
  candles: Candle[],
  ctx?: PineCompileContext,
): void {
  if (cfg.type !== "CUSTOM" || !cfg.sourceCode?.trim() || candles.length === 0) return;
  const key = pineRuntimeCacheKey(cfg, candles, ctx);
  if (cache.has(key) || inflight.has(key)) return;
  const lastFailure = failedAt.get(key);
  if (lastFailure != null && Date.now() - lastFailure < FAILURE_RETRY_MS) return;
  failedAt.delete(key);
  const scopeKey = pineIndicatorScopeKey(cfg, ctx);
  const requestGeneration = generation;
  latestRequestByScope.set(scopeKey, key);

  let promise: Promise<void>;
  promise = resolveCompileCandles(cfg, candles, ctx)
    .then((compileCandles) =>
      compilePineRuntime({
        scriptId: cfg.id,
        sourceCode: cfg.sourceCode ?? "",
        candles: runtimeCandles(compileCandles),
        inputOverrides: cfg.inputValues,
        styleOverrides: cfg.styleValues,
        timeframe: ctx?.timeframe,
      }),
    )
    .then((compiled) => {
      if (requestGeneration !== generation) return;
      if (compiled.errors.length === 0) {
        const result = limitObjectSegments(compiled.result);
        failedAt.delete(key);
        touchResult(cache, key, result);
        if (latestRequestByScope.get(scopeKey) === key) {
          touchResult(latestByScope, scopeKey, result);
        }
      } else {
        rememberFailure(key, requestGeneration);
      }
    })
    .catch(() => {
      if (requestGeneration !== generation) return;
      rememberFailure(key, requestGeneration);
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
      if (requestGeneration === generation) notify();
    });
  inflight.set(key, promise);
}

export function clearPineRuntimeCache() {
  generation += 1;
  cache.clear();
  inflight.clear();
  failedAt.clear();
  historyContextCache.clear();
  latestByScope.clear();
  latestRequestByScope.clear();
  notify();
}
