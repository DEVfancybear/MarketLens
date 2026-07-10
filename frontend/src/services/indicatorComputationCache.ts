import type { Candle, IndicatorConfig, IndicatorResult } from "@/types";
import { computeIndicator } from "@/services/indicators";
import type { PineCompileContext } from "@/services/pineRuntimeCache";
import { resolveRealtimeSeriesUpdatePlan } from "@/services/market-data/candleSeries";
import {
  incrementChartPerformanceCounter,
  measureChartPerformance,
} from "@/services/chartPerformanceProbe";
import { indicatorDependencyFor } from "@/services/indicatorDependencies";
import {
  buildEmaState,
  buildMacdState,
  buildRsiState,
  currentSessionVwap,
  latestSma,
  rsiValue,
  type MacdState,
  type RsiState,
} from "@/services/incrementalIndicatorMath";

interface IndicatorCacheEntry {
  signature: string;
  runtimeRevision: number;
  candles: readonly Candle[];
  result: IndicatorResult;
  ema?: number[];
  rsi?: RsiState;
  macd?: MacdState;
}

const MAX_ENTRIES = 64;
const cache = new Map<string, IndicatorCacheEntry>();

function cacheKey(cfg: IndicatorConfig, ctx?: PineCompileContext) {
  return `${ctx?.symbol ?? ""}:${ctx?.timeframe ?? ""}:${cfg.id}`;
}

function configSignature(cfg: IndicatorConfig) {
  return JSON.stringify(cfg);
}

function touch(key: string, entry: IndicatorCacheEntry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

function createEntry(
  signature: string,
  runtimeRevision: number,
  cfg: IndicatorConfig,
  candles: readonly Candle[],
  ctx?: PineCompileContext,
): IndicatorCacheEntry {
  const mutableCandles = candles as Candle[];
  const entry: IndicatorCacheEntry = {
    signature,
    runtimeRevision,
    candles,
    result: computeIndicator(cfg, mutableCandles, ctx),
  };
  if (cfg.type === "EMA") entry.ema = buildEmaState(candles, cfg.length);
  if (cfg.type === "RSI") entry.rsi = buildRsiState(candles, cfg.length);
  if (cfg.type === "MACD") {
    entry.macd = buildMacdState(
      candles,
      cfg.length,
      cfg.length3 ?? 26,
      cfg.length2 ?? 9,
    );
  }
  return entry;
}

function writePoint(
  result: IndicatorResult,
  key: string,
  time: number,
  value: number,
  append: boolean,
): IndicatorResult | null {
  const index = result.series.findIndex((series) => series.key === key);
  if (index < 0) return result;
  const target = result.series[index];
  const data = target.data;
  if (append && data.at(-1)?.time !== time) data.push({ time, value });
  else if (data.length > 0) data[data.length - 1] = { ...data[data.length - 1], time, value };
  else data.push({ time, value });
  const series = [...result.series];
  series[index] = { ...target, data };
  return { ...result, series };
}

function updateIncrementally(
  entry: IndicatorCacheEntry,
  cfg: IndicatorConfig,
  candles: readonly Candle[],
  append: boolean,
): IndicatorResult | null {
  const index = candles.length - 1;
  const candle = candles[index];
  if (!candle) return null;

  if (cfg.type === "SMA") {
    const value = latestSma(candles, cfg.length);
    return value == null ? entry.result : writePoint(entry.result, "sma", candle.time, value, append);
  }

  if (cfg.type === "EMA" && entry.ema) {
    const k = 2 / (cfg.length + 1);
    const previous = index === 0 ? candle.close : entry.ema[index - 1];
    const value = index === 0 ? candle.close : candle.close * k + previous * (1 - k);
    entry.ema[index] = value;
    if (candles.length < cfg.length) return entry.result;
    return writePoint(entry.result, "ema", candle.time, value, append);
  }

  if (cfg.type === "VWAP") {
    const value = currentSessionVwap(candles);
    return value == null ? entry.result : writePoint(entry.result, "vwap", candle.time, value, append);
  }

  if (cfg.type === "RSI" && entry.rsi) {
    if (index < cfg.length) return entry.result;
    if (index === cfg.length) {
      const rebuilt = buildRsiState(candles, cfg.length);
      entry.rsi = rebuilt;
    } else {
      const change = candle.close - candles[index - 1].close;
      entry.rsi.avgGain[index] =
        (entry.rsi.avgGain[index - 1] * (cfg.length - 1) + Math.max(change, 0)) / cfg.length;
      entry.rsi.avgLoss[index] =
        (entry.rsi.avgLoss[index - 1] * (cfg.length - 1) + Math.max(-change, 0)) / cfg.length;
    }
    return writePoint(
      entry.result,
      "rsi",
      candle.time,
      rsiValue(entry.rsi.avgGain[index], entry.rsi.avgLoss[index]),
      append,
    );
  }

  if (cfg.type === "MACD" && entry.macd) {
    const fastK = 2 / (cfg.length + 1);
    const slowK = 2 / ((cfg.length3 ?? 26) + 1);
    const signalK = 2 / ((cfg.length2 ?? 9) + 1);
    entry.macd.fast[index] = index === 0
      ? candle.close
      : candle.close * fastK + entry.macd.fast[index - 1] * (1 - fastK);
    entry.macd.slow[index] = index === 0
      ? candle.close
      : candle.close * slowK + entry.macd.slow[index - 1] * (1 - slowK);
    const macd = entry.macd.fast[index] - entry.macd.slow[index];
    entry.macd.signal[index] = index === 0
      ? macd
      : macd * signalK + entry.macd.signal[index - 1] * (1 - signalK);
    const signal = entry.macd.signal[index];
    let result = writePoint(entry.result, "macd", candle.time, macd, append);
    if (!result) return null;
    result = writePoint(result, "signal", candle.time, signal, append);
    if (!result) return null;
    return writePoint(result, "hist", candle.time, macd - signal, append);
  }

  return null;
}

export function computeCachedIndicator(
  cfg: IndicatorConfig,
  candles: readonly Candle[],
  ctx?: PineCompileContext,
  runtimeRevision = 0,
): IndicatorResult {
  const key = cacheKey(cfg, ctx);
  const signature = configSignature(cfg);
  const dependency = indicatorDependencyFor(cfg);
  const existing = cache.get(key);
  if (
    existing?.signature === signature &&
    existing.candles === candles &&
    (cfg.type !== "CUSTOM" || existing.runtimeRevision === runtimeRevision)
  ) {
    incrementChartPerformanceCounter("indicator.cache.identityHits");
    touch(key, existing);
    return existing.result;
  }

  if (existing?.signature === signature && dependency.kind !== "full-history") {
    const plan = resolveRealtimeSeriesUpdatePlan(existing.candles, candles, true);
    if (plan === "append" || plan === "update-latest") {
      const result = measureChartPerformance(
        "indicator.compute.incremental",
        () => updateIncrementally(existing, cfg, candles, plan === "append"),
        { type: cfg.type, candles: candles.length },
      );
      if (result) {
        existing.candles = candles;
        existing.result = result;
        incrementChartPerformanceCounter(`indicator.cache.${plan}`);
        touch(key, existing);
        return result;
      }
    }
  }

  incrementChartPerformanceCounter(
    cfg.type === "ADR"
      ? "indicator.cache.fullHistoryFallbacks"
      : "indicator.cache.rebuilds",
  );
  const entry = createEntry(signature, runtimeRevision, cfg, candles, ctx);
  touch(key, entry);
  return entry.result;
}

export function clearIndicatorComputationCache() {
  cache.clear();
}
