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

const cache = new Map<string, IndicatorResult>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<Listener>();
const historyContextCache = new Map<string, Promise<Candle[]>>();
const latestByScope = new Map<string, IndicatorResult>();
const MAX_OBJECT_SEGMENTS_PER_HANDLE = 3;

export type { PineCompileContext } from "@/services/pineRuntimeCachePolicy";

function notify() {
  for (const listener of listeners) listener();
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
    promise = getHistoricalDataService().loadHistory({
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      limit,
    });
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
    cache.get(pineRuntimeCacheKey(cfg, candles, ctx)) ??
    latestByScope.get(pineIndicatorScopeKey(cfg, ctx)) ??
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
  const scopeKey = pineIndicatorScopeKey(cfg, ctx);

  const promise = resolveCompileCandles(cfg, candles, ctx)
    .then((compileCandles) =>
      compilePineRuntime({
        scriptId: cfg.id,
        sourceCode: cfg.sourceCode ?? "",
        candles: compileCandles,
        inputOverrides: cfg.inputValues,
        styleOverrides: cfg.styleValues,
      }),
    )
    .then((compiled) => {
      const result =
        compiled.errors.length === 0
          ? limitObjectSegments(compiled.result)
          : { id: cfg.id, series: [] };
      cache.set(key, result);
      if (compiled.errors.length === 0) {
        latestByScope.set(scopeKey, result);
      }
    })
    .catch(() => {
      cache.set(key, { id: cfg.id, series: [] });
    })
    .finally(() => {
      inflight.delete(key);
      notify();
    });
  inflight.set(key, promise);
}

export function clearPineRuntimeCache() {
  cache.clear();
  inflight.clear();
  historyContextCache.clear();
  latestByScope.clear();
  notify();
}
