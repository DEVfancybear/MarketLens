import type { Candle, IndicatorConfig, Timeframe } from "@/types";

export interface IndicatorRuntimeContext {
  symbol?: string;
  timeframe?: Timeframe;
}

export function stableIndicatorRuntimeJSON(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableIndicatorRuntimeJSON).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableIndicatorRuntimeJSON(item)}`)
    .join(",")}}`;
}

export function indicatorRuntimeHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function indicatorCandleSignature(candles: readonly Candle[]): string {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) return "empty";
  let contentHash = 2166136261;
  for (const candle of candles) {
    for (const value of [
      candle.time,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume,
    ]) {
      const text = String(value);
      for (let index = 0; index < text.length; index += 1) {
        contentHash ^= text.charCodeAt(index);
        contentHash = Math.imul(contentHash, 16777619);
      }
    }
  }
  return [
    candles.length,
    first.time,
    last.time,
    (contentHash >>> 0).toString(36),
  ].join(":");
}

export function indicatorRuntimeScopeKey(
  config: IndicatorConfig,
  context?: IndicatorRuntimeContext,
): string {
  return [
    config.id,
    config.type,
    indicatorRuntimeHash(stableIndicatorRuntimeJSON(config)),
    context?.symbol ?? "",
    context?.timeframe ?? "",
  ].join("|");
}

export function indicatorRuntimeCacheKey(
  config: IndicatorConfig,
  candles: readonly Candle[],
  context?: IndicatorRuntimeContext,
): string {
  return [
    indicatorRuntimeScopeKey(config, context),
    indicatorCandleSignature(candles),
  ].join("|");
}
