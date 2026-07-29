import type { Candle, IndicatorConfig, IndicatorResult, Timeframe } from "@/types";
import { computeIndicatorRuntime } from "@/services/api/resources/indicatorRuntimeApi";
import { loadIndicatorDefinition } from "@/services/indicatorDefinitions";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import {
  LatestPerScopeScheduler,
  ScopedLruCache,
} from "@/services/indicatorRuntimeScheduler";
import {
  indicatorRuntimeCacheKey,
  indicatorRuntimeScopeKey,
  canUseLatestIndicatorRuntimeResult,
  normalizeReplayCutoff,
  normalizeReplaySessionId,
  bumpLiveHistoryVersion,
  type IndicatorRuntimeContext,
} from "@/services/indicatorRuntimePolicy";

type Listener = (scope?: string) => void;

const MAX_RUNTIME_CANDLES = 5_000;
const MAX_ENTRIES = 64;
const MAX_HISTORY_CONTEXT_ENTRIES = 24;
const MAX_CONCURRENT_RUNTIME_REQUESTS = 4;
const MAX_LIVE_RESULTS_PER_SCOPE = 1;
const MAX_REPLAY_RESULTS_PER_SCOPE = 4;
const FAILURE_RETRY_MS = 15_000;
const MAX_OBJECT_SEGMENTS_PER_HANDLE = 3;

const cache = new ScopedLruCache<IndicatorResult>(MAX_ENTRIES);
const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const historyContextCache = new Map<string, Promise<Candle[]>>();
interface LatestRuntimeResult {
  result: IndicatorResult;
  replaySessionId?: string;
  replayCutoff?: number;
}

const latestByScope = new Map<string, LatestRuntimeResult>();
interface PendingRuntimeRequest {
  config: IndicatorConfig;
  candles: readonly Candle[];
  context?: IndicatorRuntimeContext;
  runtimeKey: string;
  scope: string;
  requestGeneration: number;
}

const scheduledKeys = new Set<string>();
const abortControllers = new Map<string, AbortController>();
const runtimeScopeByKey = new Map<string, string>();
const retainedScopeRefs = new Map<string, number>();
const listeners = new Set<Listener>();
let generation = 0;
const runtimeScheduler = new LatestPerScopeScheduler<PendingRuntimeRequest>({
  maxConcurrent: MAX_CONCURRENT_RUNTIME_REQUESTS,
  run: executeRuntimeRequest,
  onSettled: (task) => notify(task.scope),
});

export type { IndicatorRuntimeContext } from "@/services/indicatorRuntimePolicy";

function notify(scope?: string) {
  for (const listener of listeners) listener(scope);
}

function rememberFailure(scope: string, requestGeneration: number) {
  const timestamp = Date.now();
  failedAt.delete(scope);
  failedAt.set(scope, timestamp);
  while (failedAt.size > MAX_ENTRIES) {
    const oldest = failedAt.keys().next().value as string | undefined;
    if (!oldest) break;
    failedAt.delete(oldest);
  }
  globalThis.setTimeout(() => {
    if (requestGeneration !== generation || failedAt.get(scope) !== timestamp) return;
    failedAt.delete(scope);
    notify(scope);
  }, FAILURE_RETRY_MS);
}

function touchResult<T>(target: Map<string, T>, key: string, result: T) {
  target.delete(key);
  target.set(key, result);
  while (target.size > MAX_ENTRIES) {
    const oldest = target.keys().next().value as string | undefined;
    if (!oldest) break;
    target.delete(oldest);
  }
}

function readResult<T>(target: Map<string, T>, key: string): T | null {
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

function resultEntriesForScope(context?: IndicatorRuntimeContext): number {
  const isReplay =
    normalizeReplaySessionId(context?.replaySessionId) != null ||
    normalizeReplayCutoff(context?.replayCutoff) != null;
  return isReplay
    ? MAX_REPLAY_RESULTS_PER_SCOPE
    : MAX_LIVE_RESULTS_PER_SCOPE;
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
  replayBefore?: number,
  signal?: AbortSignal,
): Promise<Candle[]> {
  if (!context.symbol || !context.timeframe) return [];
  const replaySessionId = normalizeReplaySessionId(context.replaySessionId);
  const replayCutoff = normalizeReplayCutoff(context.replayCutoff);
  // A Replay history window must never share the live/latest cache entry. One
  // bounded history promise is enough for a session: newly revealed candles
  // are merged into it and every request is filtered at its current cutoff.
  const scope = replaySessionId
    ? `replay-session:${replaySessionId}`
    : replayCutoff == null
      ? "live"
      : `replay-cutoff:${replayCutoff}`;
  const key = JSON.stringify([scope, context.symbol, context.timeframe, limit]);
  let promise = historyContextCache.get(key);
  if (!promise) {
    promise = getHistoricalDataService()
      .loadHistory({
        symbol: context.symbol,
        timeframe: context.timeframe,
        limit,
        ...(replayBefore != null ? { before: replayBefore } : {}),
      }, { signal })
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
  signal?: AbortSignal,
): Promise<Candle[]> {
  const replayCutoff = normalizeReplayCutoff(context?.replayCutoff);
  const replaySessionId = normalizeReplaySessionId(context?.replaySessionId);
  // The candle array is authoritative for Replay. This guard also protects
  // against a stale hydration race before the new backend bars arrive.
  const boundedCandles = replayCutoff == null
    ? [...candles]
    : candles.filter((candle) => candle.time <= replayCutoff);
  // A Replay session without a valid authoritative cutoff is fail-closed:
  // compute only from bars already supplied by that session and never ask the
  // live history provider for warm-up context.
  if (replaySessionId && replayCutoff == null) {
    return boundedCandles;
  }
  if (!(await requiresHistoryContext(config)) || !context?.symbol || !context.timeframe) {
    return boundedCandles;
  }
  const targetBars = historyBarsForTimeframe(context.timeframe);
  if (boundedCandles.length >= targetBars) return boundedCandles;
  try {
    // Provider OHLC for the current replay bucket may already contain its
    // future high/low/close. Only request warm-up bars strictly before the
    // latest authoritative replay candle, then let replay candles win merges.
    const isReplay = replaySessionId != null || replayCutoff != null;
    const replayBefore = isReplay ? boundedCandles.at(-1)?.time : undefined;
    if (isReplay && replayBefore == null) return boundedCandles;
    const merged = mergeCandles(
      await loadHistoryContext(context, targetBars, replayBefore, signal),
      boundedCandles,
    );
    return replayCutoff == null
      ? merged
      : merged.filter((candle) => candle.time <= replayCutoff);
  } catch {
    if (signal?.aborted) throw new DOMException("Indicator history request aborted", "AbortError");
    return boundedCandles;
  }
}

export function subscribeIndicatorRuntimeCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === "AbortError";
  return (error as { name?: string }).name === "AbortError";
}

function cancelRuntimeScope(scope: string): void {
  const pending = runtimeScheduler.cancel(scope);
  if (pending) scheduledKeys.delete(pending.runtimeKey);
  for (const [runtimeKey, runtimeScope] of runtimeScopeByKey) {
    if (runtimeScope !== scope) continue;
    abortControllers.get(runtimeKey)?.abort();
  }
  failedAt.delete(scope);
}

/**
 * Keep runtime work alive only while at least one mounted chart is using a
 * scope. The reference count matters for multi-pane layouts where the same
 * symbol/indicator can be visible in more than one pane.
 */
export function retainIndicatorRuntimeScopes(
  scopes: Iterable<string>,
): () => void {
  const retained = [...new Set(scopes)];
  for (const scope of retained) {
    retainedScopeRefs.set(scope, (retainedScopeRefs.get(scope) ?? 0) + 1);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const scope of retained) {
      const next = (retainedScopeRefs.get(scope) ?? 1) - 1;
      if (next > 0) {
        retainedScopeRefs.set(scope, next);
      } else {
        retainedScopeRefs.delete(scope);
        cancelRuntimeScope(scope);
      }
    }
  };
}

/** Drop only live warm-up history affected by an authoritative MT5 refresh. */
export function invalidateIndicatorHistoryContext(symbol: string, timeframe: Timeframe): void {
  const normalizedSymbol = symbol.trim().toUpperCase();
  bumpLiveHistoryVersion(symbol, timeframe);
  for (const key of historyContextCache.keys()) {
    try {
      const [scope, cachedSymbol, cachedTimeframe] = JSON.parse(key) as unknown[];
      if (scope === "live" && cachedSymbol === normalizedSymbol && cachedTimeframe === timeframe) {
        historyContextCache.delete(key);
      }
    } catch {
      // Cache keys are internal JSON tuples; discard malformed legacy entries.
      historyContextCache.delete(key);
    }
  }
  notify();
}

export function getCachedIndicatorRuntimeResult(
  config: IndicatorConfig,
  candles: readonly Candle[],
  context?: IndicatorRuntimeContext,
): IndicatorResult | null {
  const exact = cache.get(indicatorRuntimeCacheKey(config, candles, context));
  if (exact) return exact;
  const latest = readResult(latestByScope, indicatorRuntimeScopeKey(config, context));
  if (!latest || !canUseLatestIndicatorRuntimeResult(context, latest)) return null;
  return latest.result;
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
  // Never let a malformed/missing Replay snapshot degrade into an unbounded
  // runtime request. The chart will render an empty result until a valid
  // backend-owned `visibleThrough` arrives.
  if (
    normalizeReplaySessionId(context?.replaySessionId) &&
    normalizeReplayCutoff(context?.replayCutoff) == null
  ) {
    return;
  }
  const scope = indicatorRuntimeScopeKey(config, context);
  const lastFailure = failedAt.get(scope);
  if (lastFailure != null && Date.now() - lastFailure < FAILURE_RETRY_MS) return;
  failedAt.delete(scope);

  const runtimeKey = indicatorRuntimeCacheKey(config, candles, context);
  if (cache.has(runtimeKey) || scheduledKeys.has(runtimeKey) || inflight.has(runtimeKey)) return;
  const requestGeneration = generation;
  const request: PendingRuntimeRequest = {
    config,
    candles,
    context,
    runtimeKey,
    scope,
    requestGeneration,
  };
  scheduledKeys.add(runtimeKey);
  const replaced = runtimeScheduler.enqueue(scope, request);
  if (replaced) scheduledKeys.delete(replaced.runtimeKey);
}

function executeRuntimeRequest(request: PendingRuntimeRequest): Promise<void> {
  const {
    config,
    candles,
    context,
    runtimeKey,
    scope,
    requestGeneration,
  } = request;
  if (requestGeneration !== generation) {
    scheduledKeys.delete(runtimeKey);
    return Promise.resolve();
  }

  const controller = new AbortController();
  abortControllers.set(runtimeKey, controller);
  runtimeScopeByKey.set(runtimeKey, scope);
  let promise: Promise<void>;
  promise = resolveRuntimeCandles(config, candles, context, controller.signal)
    .then((resolved) =>
      computeIndicatorRuntime(
        config,
        runtimeCandles(resolved),
        context,
        controller.signal,
      ),
    )
    .then((response) => {
      if (requestGeneration !== generation) return;
      if (response.errors.length === 0) {
        const result = limitObjectSegments(response.result);
        failedAt.delete(scope);
        cache.set(
          runtimeKey,
          scope,
          result,
          resultEntriesForScope(context),
        );
        // Requests for a scope are serialized. An older live result is a safe
        // temporary fallback while the newest pending candle snapshot runs;
        // Replay reads still pass through the causal cutoff guard below.
        touchResult(latestByScope, scope, {
          result,
          replaySessionId: normalizeReplaySessionId(context?.replaySessionId),
          replayCutoff: normalizeReplayCutoff(context?.replayCutoff),
        });
      } else if (!controller.signal.aborted) {
        rememberFailure(scope, requestGeneration);
      }
    })
    .catch((error) => {
      if (
        requestGeneration === generation &&
        !controller.signal.aborted &&
        !isAbortError(error)
      ) {
        rememberFailure(scope, requestGeneration);
      }
    })
    .finally(() => {
      scheduledKeys.delete(runtimeKey);
      if (inflight.get(runtimeKey) === promise) inflight.delete(runtimeKey);
      if (abortControllers.get(runtimeKey) === controller) {
        abortControllers.delete(runtimeKey);
      }
      if (runtimeScopeByKey.get(runtimeKey) === scope) {
        runtimeScopeByKey.delete(runtimeKey);
      }
    });
  inflight.set(runtimeKey, promise);
  return promise;
}

export function clearIndicatorRuntimeCache() {
  generation += 1;
  runtimeScheduler.clear();
  for (const controller of abortControllers.values()) controller.abort();
  abortControllers.clear();
  runtimeScopeByKey.clear();
  retainedScopeRefs.clear();
  scheduledKeys.clear();
  cache.clear();
  inflight.clear();
  failedAt.clear();
  historyContextCache.clear();
  latestByScope.clear();
  notify();
}
