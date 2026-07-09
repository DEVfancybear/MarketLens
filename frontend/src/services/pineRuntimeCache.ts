import type { Candle, IndicatorConfig, IndicatorResult } from "@/types";
import { compilePineRuntime } from "@/services/api/resources/pineRuntimeApi";
import { compilePineScript } from "@/services/pineScript";

type Listener = () => void;

const cache = new Map<string, IndicatorResult>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<Listener>();

function stableJSON(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJSON(item)}`)
    .join(",")}}`;
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function candleRangeSignature(candles: Candle[]): string {
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
      for (let i = 0; i < text.length; i++) {
        contentHash ^= text.charCodeAt(i);
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

function cacheKey(cfg: IndicatorConfig, candles: Candle[]) {
  return [
    cfg.id,
    cfg.scriptId ?? "",
    hashString(cfg.sourceCode ?? ""),
    candleRangeSignature(candles),
    hashString(stableJSON(cfg.inputValues ?? {})),
    hashString(stableJSON(cfg.styleValues ?? {})),
  ].join("|");
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribePineRuntimeCache(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCachedPineIndicatorResult(
  cfg: IndicatorConfig,
  candles: Candle[],
): IndicatorResult | null {
  if (cfg.type !== "CUSTOM" || !cfg.sourceCode?.trim()) {
    return { id: cfg.id, series: [] };
  }
  return cache.get(cacheKey(cfg, candles)) ?? null;
}

export function ensurePineIndicatorResult(
  cfg: IndicatorConfig,
  candles: Candle[],
): void {
  if (cfg.type !== "CUSTOM" || !cfg.sourceCode?.trim() || candles.length === 0) return;
  const key = cacheKey(cfg, candles);
  if (cache.has(key) || inflight.has(key)) return;

  const promise = compilePineRuntime({
    scriptId: cfg.id,
    sourceCode: cfg.sourceCode,
    candles,
    inputOverrides: cfg.inputValues,
    styleOverrides: cfg.styleValues,
  })
    .then((compiled) => {
      const hasUnsupportedObjectRuntime = (compiled.unsupportedFeatures ?? []).some((item) =>
        item === "line.new" ||
        item === "box.new" ||
        item === "label.new" ||
        item === "table.new",
      );
      if (compiled.errors.length === 0 && !hasUnsupportedObjectRuntime) {
        cache.set(key, compiled.result);
        return;
      }

      // Temporary migration bridge: object-heavy scripts such as ADR still use
      // the existing TypeScript runtime until the Go object runtime reaches
      // parity. This keeps chart behavior intact while new Pine support moves
      // to backend first.
      cache.set(
        key,
        compilePineScript(
          cfg.sourceCode ?? "",
          candles,
          cfg.id,
          cfg.inputValues,
          cfg.styleValues,
        ).result,
      );
    })
    .catch(() => {
      cache.set(
        key,
        compilePineScript(
          cfg.sourceCode ?? "",
          candles,
          cfg.id,
          cfg.inputValues,
          cfg.styleValues,
        ).result,
      );
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
  notify();
}
