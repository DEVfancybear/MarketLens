import type { Candle, IndicatorConfig, Timeframe } from "@/types";

export interface IndicatorRuntimeContext {
  symbol?: string;
  timeframe?: Timeframe;
  /** Pine `syminfo.type`, sourced from the backend-owned market catalog. */
  symbolType?: string;
  /** Pine `syminfo.mintick`, sourced from the active provider symbol. */
  mintick?: number;
  /** Exchange/chart timezone used by Pine time formatting when available. */
  timezone?: string;
  /** Backend Replay session identity. Omitted for the live chart. */
  replaySessionId?: string;
  /** Latest candle timestamp that an indicator is allowed to observe. */
  replayCutoff?: number;
}

const liveHistoryVersions = new Map<string, number>();
const candleSignatureCache = new WeakMap<readonly Candle[], string>();

function liveHistoryKey(symbol: string, timeframe: Timeframe): string {
  return `${symbol.trim().toUpperCase()}:${timeframe}`;
}

/** Bump the live history generation so indicators cannot reuse warm-up data. */
export function bumpLiveHistoryVersion(symbol: string, timeframe: Timeframe): number {
  const key = liveHistoryKey(symbol, timeframe);
  const next = (liveHistoryVersions.get(key) ?? 0) + 1;
  liveHistoryVersions.set(key, next);
  return next;
}

export function liveHistoryVersion(symbol: string, timeframe: Timeframe): number {
  return liveHistoryVersions.get(liveHistoryKey(symbol, timeframe)) ?? 0;
}

/**
 * Replay timestamps are part of the data contract, rather than a UI hint.
 * Keep malformed values out of cache keys and request payloads so a failed
 * replay snapshot cannot accidentally turn into an unbounded live request.
 */
export function normalizeReplayCutoff(value: unknown): number | undefined {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 253_402_300_799
  ) {
    return undefined;
  }
  return value;
}

export function normalizeReplaySessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/** Convert the Replay API's RFC3339 `visibleThrough` value to UNIX seconds. */
export function replayCutoffFromVisibleThrough(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  return normalizeReplayCutoff(Math.floor(milliseconds / 1000));
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
  const cached = candleSignatureCache.get(candles);
  if (cached) return cached;
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) {
    candleSignatureCache.set(candles, "empty");
    return "empty";
  }
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
  const signature = [
    candles.length,
    first.time,
    last.time,
    (contentHash >>> 0).toString(36),
  ].join(":");
  candleSignatureCache.set(candles, signature);
  return signature;
}

export function indicatorRuntimeScopeKey(
  config: IndicatorConfig,
  context?: IndicatorRuntimeContext,
): string {
  const replaySessionId = normalizeReplaySessionId(context?.replaySessionId);
  const replayCutoff = normalizeReplayCutoff(context?.replayCutoff);
  const runtimeMode = replaySessionId
    ? `replay:${replaySessionId}`
    : replayCutoff != null
      ? "replay:unsessioned"
      : "live";
  const historyVersion = runtimeMode === "live" && context?.symbol && context.timeframe
    ? liveHistoryVersion(context.symbol, context.timeframe)
    : undefined;
  return [
    config.id,
    config.type,
    indicatorRuntimeHash(stableIndicatorRuntimeJSON(config)),
    context?.symbol ?? "",
    context?.timeframe ?? "",
    context?.symbolType ?? "",
    context?.mintick ?? "",
    context?.timezone ?? "",
    // Keep the cutoff out of the scope key so a forward Replay can safely use
    // the previous result as a temporary fallback. The exact candle cache key
    // below still includes the cutoff. Session identity keeps live and Replay
    // results (and separate Replay sessions) isolated from one another.
    runtimeMode,
    ...(historyVersion != null ? [`history:${historyVersion}`] : []),
  ].join("|");
}

export function indicatorRuntimeCacheKey(
  config: IndicatorConfig,
  candles: readonly Candle[],
  context?: IndicatorRuntimeContext,
): string {
  return [
    indicatorRuntimeScopeKey(config, context),
    `cutoff:${normalizeReplayCutoff(context?.replayCutoff) ?? ""}`,
    indicatorCandleSignature(candles),
  ].join("|");
}

/**
 * Decide whether a cached result is safe as a temporary render fallback.
 *
 * A result computed at an earlier Replay cutoff is causal for a later cutoff,
 * but the reverse is a look-ahead leak. Live and Replay sessions are always
 * isolated, as are two different Replay session ids.
 */
export function canUseLatestIndicatorRuntimeResult(
  requested?: Pick<IndicatorRuntimeContext, "replaySessionId" | "replayCutoff">,
  cached?: Pick<IndicatorRuntimeContext, "replaySessionId" | "replayCutoff">,
): boolean {
  const requestedSession = normalizeReplaySessionId(requested?.replaySessionId);
  const cachedSession = normalizeReplaySessionId(cached?.replaySessionId);
  if (requestedSession !== cachedSession) return false;

  const requestedCutoff = normalizeReplayCutoff(requested?.replayCutoff);
  const cachedCutoff = normalizeReplayCutoff(cached?.replayCutoff);
  // A Replay session without two valid cutoffs is not a causal fallback.
  // The request path fails closed in this state as well.
  if (requestedSession && (requestedCutoff == null || cachedCutoff == null)) return false;
  // A live result must never be replaced by an unsessioned Replay result, and
  // vice versa. Two ordinary live contexts remain compatible.
  if (requestedCutoff == null || cachedCutoff == null) return requestedCutoff == null && cachedCutoff == null;
  return cachedCutoff <= requestedCutoff;
}
