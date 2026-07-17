import type { Candle, IndicatorConfig, IndicatorResult } from "@/types";
import type { PineCompileContext } from "@/services/pineRuntimeCachePolicy";
import { computeIndicatorRuntime } from "@/services/api/resources/indicatorRuntimeApi";

type Listener = () => void;

const MAX_RUNTIME_CANDLES = 5_000;
const MAX_ENTRIES = 64;
const FAILURE_RETRY_MS = 15_000;
const cache = new Map<string, IndicatorResult>();
const inflight = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const latestByScope = new Map<string, IndicatorResult>();
const latestRequestByScope = new Map<string, string>();
const listeners = new Set<Listener>();
let generation = 0;

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

function hash(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(36);
}

function stableJSON(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJSON(item)}`)
    .join(",")}}`;
}

function scopeKey(config: IndicatorConfig, ctx?: PineCompileContext): string {
  return [
    config.id,
    config.type,
    hash(stableJSON(config)),
    ctx?.symbol ?? "",
    ctx?.timeframe ?? "",
  ].join("|");
}

function candleKey(candles: readonly Candle[]): string {
  const selected = candles.length > MAX_RUNTIME_CANDLES
    ? candles.slice(-MAX_RUNTIME_CANDLES)
    : candles;
  if (selected.length === 0) return "empty";
  const first = selected[0];
  const last = selected[selected.length - 1];
  // Include OHLC so a forming-bar correction causes a backend recompute.
  return hash(
    `${selected.length}:${first.time}:${last.time}:` +
      selected
        .map((candle) =>
          [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].join(","),
        )
        .join(";"),
  );
}

function key(config: IndicatorConfig, candles: readonly Candle[], ctx?: PineCompileContext): string {
  return `${scopeKey(config, ctx)}|${candleKey(candles)}`;
}

function touch(cacheKey: string, result: IndicatorResult) {
  cache.delete(cacheKey);
  cache.set(cacheKey, result);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function touchLatest(scope: string, result: IndicatorResult) {
  latestByScope.delete(scope);
  latestByScope.set(scope, result);
  while (latestByScope.size > MAX_ENTRIES) {
    const oldest = latestByScope.keys().next().value as string | undefined;
    if (!oldest) break;
    latestByScope.delete(oldest);
    latestRequestByScope.delete(oldest);
  }
}

function runtimeCandles(candles: readonly Candle[]): Candle[] {
  return candles.length > MAX_RUNTIME_CANDLES
    ? [...candles.slice(-MAX_RUNTIME_CANDLES)]
    : [...candles];
}

export function subscribeIndicatorRuntimeCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedIndicatorRuntimeResult(
  config: IndicatorConfig,
  candles: readonly Candle[],
  ctx?: PineCompileContext,
): IndicatorResult | null {
  return cache.get(key(config, candles, ctx)) ?? latestByScope.get(scopeKey(config, ctx)) ?? null;
}

export function ensureIndicatorRuntimeResult(
  config: IndicatorConfig,
  candles: readonly Candle[],
  ctx?: PineCompileContext,
): void {
  if (config.type === "CUSTOM" || candles.length === 0) return;
  const runtimeKey = key(config, candles, ctx);
  if (cache.has(runtimeKey) || inflight.has(runtimeKey)) return;
  const lastFailure = failedAt.get(runtimeKey);
  if (lastFailure != null && Date.now() - lastFailure < FAILURE_RETRY_MS) return;
  failedAt.delete(runtimeKey);
  const scope = scopeKey(config, ctx);
  const requestGeneration = generation;
  latestRequestByScope.set(scope, runtimeKey);
  let promise: Promise<void>;
  promise = computeIndicatorRuntime(config, runtimeCandles(candles), ctx)
    .then((response) => {
      if (requestGeneration !== generation) return;
      if (response.errors.length === 0) {
        failedAt.delete(runtimeKey);
        touch(runtimeKey, response.result);
        if (latestRequestByScope.get(scope) === runtimeKey) {
          touchLatest(scope, response.result);
        }
      } else {
        rememberFailure(runtimeKey, requestGeneration);
      }
    })
    .catch(() => {
      if (requestGeneration !== generation) return;
      rememberFailure(runtimeKey, requestGeneration);
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
  latestByScope.clear();
  latestRequestByScope.clear();
  notify();
}
