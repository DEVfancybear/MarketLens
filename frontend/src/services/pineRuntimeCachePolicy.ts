import type { Candle, IndicatorConfig, Timeframe } from "@/types";

export interface PineCompileContext {
  symbol?: string;
  timeframe?: Timeframe;
}

export function stablePineRuntimeJSON(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stablePineRuntimeJSON).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stablePineRuntimeJSON(item)}`)
    .join(",")}}`;
}

export function pineRuntimeHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function needsHigherTimeframeContext(sourceCode: string | undefined): boolean {
  return /\brequest\.security\s*\(/.test(sourceCode ?? "");
}

export function pineCandleRangeSignature(
  candles: Candle[],
  includeContentHash: boolean,
): string {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) return "empty";
  let contentHash = 2166136261;
  if (includeContentHash) {
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
        for (let i = 0; i < text.length; i++) {
          contentHash ^= text.charCodeAt(i);
          contentHash = Math.imul(contentHash, 16777619);
        }
      }
    }
  }
  return [
    candles.length,
    first.time,
    last.time,
    includeContentHash ? (contentHash >>> 0).toString(36) : "bar-window",
  ].join(":");
}

export function pineIndicatorScopeKey(
  cfg: IndicatorConfig,
  ctx?: PineCompileContext,
): string {
  return [
    cfg.id,
    cfg.scriptId ?? "",
    pineRuntimeHash(cfg.sourceCode ?? ""),
    pineRuntimeHash(stablePineRuntimeJSON(cfg.inputValues ?? {})),
    pineRuntimeHash(stablePineRuntimeJSON(cfg.styleValues ?? {})),
    ctx?.symbol ?? "",
    ctx?.timeframe ?? "",
  ].join("|");
}

export function pineRuntimeCacheKey(
  cfg: IndicatorConfig,
  candles: Candle[],
  ctx?: PineCompileContext,
): string {
  const contentSensitive = !needsHigherTimeframeContext(cfg.sourceCode);
  return [
    pineIndicatorScopeKey(cfg, ctx),
    pineCandleRangeSignature(candles, contentSensitive),
  ].join("|");
}
