import type {
  MarketProvider,
  MarketSessionState,
  MarketSessionStatus,
} from "@/types";

type UnknownRecord = Record<string, unknown>;

const SESSION_STATES = new Set<MarketSessionState>([
  "open",
  "closed",
  "unknown",
]);

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function unixSeconds(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

/** Normalize one public Go `/mt5/stream` market-session item. */
export function normalizeMt5MarketSession(
  value: unknown,
  receivedAt = Date.now() / 1000,
  defaultSource?: string,
): MarketSessionStatus | null {
  const item = asRecord(value);
  if (!item) return null;

  const symbol = optionalText(item.symbol)?.toUpperCase();
  const stateValue = optionalText(item.state)?.toLowerCase() as
    | MarketSessionState
    | undefined;
  if (!symbol || !stateValue || !SESSION_STATES.has(stateValue)) return null;

  const capturedAt = Number.isFinite(receivedAt) && receivedAt > 0
    ? receivedAt
    : Date.now() / 1000;
  const parsedServerTime = unixSeconds(item.serverTime);
  const parsedObservedAt = unixSeconds(item.observedAt);
  // Explicit unknown observations with zeroed clocks are still meaningful:
  // they must invalidate a previously-open session immediately. Open/closed
  // observations, however, are not authoritative without both clocks.
  if (stateValue !== "unknown" && (!parsedServerTime || !parsedObservedAt)) {
    return null;
  }
  const explicitInvalidation = stateValue === "unknown"
    && !parsedServerTime
    && !parsedObservedAt;
  const serverTime = parsedServerTime ?? (explicitInvalidation ? 0 : capturedAt);
  const observedAt = parsedObservedAt ?? (explicitInvalidation ? 0 : capturedAt);

  return {
    provider: "mt5",
    symbol,
    state: stateValue,
    scheduledOpen: stateValue === "open" && item.scheduledOpen === true,
    reason: optionalText(item.reason),
    sessionOpenAt: unixSeconds(item.sessionOpenAt),
    sessionCloseAt: unixSeconds(item.sessionCloseAt),
    nextOpenAt: unixSeconds(item.nextOpenAt),
    nextTransitionAt: unixSeconds(item.nextTransitionAt),
    serverTime,
    observedAt,
    validUntil: unixSeconds(item.validUntil),
    source: optionalText(item.source) ?? optionalText(defaultSource),
    receivedAt: capturedAt,
  };
}

/** Normalize the `sessions` array carried by snapshot and market_status WS messages. */
export function normalizeMt5MarketSessions(
  value: unknown,
  receivedAt = Date.now() / 1000,
  defaultSource?: string,
): MarketSessionStatus[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = normalizeMt5MarketSession(item, receivedAt, defaultSource);
    return normalized ? [normalized] : [];
  });
}

function isStrictlyOlder(
  incoming: MarketSessionStatus,
  current: MarketSessionStatus,
): boolean {
  // The backend deliberately emits a zero-clock unknown when its authoritative
  // session feed disconnects. It is an invalidation command, not an observation
  // to order by the browser clock, so it must always replace a cached open.
  if (
    incoming.state === "unknown"
    && incoming.observedAt === 0
    && incoming.serverTime === 0
  ) {
    return false;
  }
  if (incoming.observedAt !== current.observedAt) {
    return incoming.observedAt < current.observedAt;
  }
  return incoming.serverTime < current.serverTime;
}

/** Merge session deltas while refusing an older snapshot/delta for a symbol. */
export function mergeMarketSessionStatuses(
  current: Readonly<Record<string, MarketSessionStatus>>,
  incoming: readonly MarketSessionStatus[],
): Record<string, MarketSessionStatus> {
  let next: Record<string, MarketSessionStatus> | null = null;
  for (const status of incoming) {
    const symbol = status.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const previous = current[symbol];
    if (previous && isStrictlyOlder(status, previous)) continue;
    next ??= { ...current };
    next[symbol] = status.symbol === symbol ? status : { ...status, symbol };
  }
  return next ?? current as Record<string, MarketSessionStatus>;
}

/** Remove provider-owned statuses so stale `open` never survives a disconnect. */
export function clearMarketSessionsByProvider(
  current: Readonly<Record<string, MarketSessionStatus>>,
  provider: MarketProvider,
): Record<string, MarketSessionStatus> {
  let next: Record<string, MarketSessionStatus> | null = null;
  for (const [symbol, status] of Object.entries(current)) {
    if (status.provider !== provider) continue;
    next ??= { ...current };
    delete next[symbol];
  }
  return next ?? current as Record<string, MarketSessionStatus>;
}

/**
 * Advance from the backend's UTC observation using only elapsed browser time,
 * so a workstation clock offset cannot skew expiry or session boundaries.
 */
export function marketSessionNow(
  status: MarketSessionStatus,
  clientNow: number,
): number {
  if (!Number.isFinite(clientNow)) return status.observedAt;
  return status.observedAt + Math.max(0, clientNow - status.receivedAt);
}

/** True only while an authoritative open status remains fresh and pre-close. */
export function isMarketSessionOpenForCountdown(
  status: MarketSessionStatus,
  now: number,
): boolean {
  if (status.state !== "open") return false;
  if (!status.scheduledOpen) return false;
  if (!status.validUntil || now >= status.validUntil) return false;
  if (!status.sessionCloseAt && !status.nextTransitionAt) return false;
  if (status.sessionCloseAt && now >= status.sessionCloseAt) return false;
  if (status.nextTransitionAt && now >= status.nextTransitionAt) return false;
  return true;
}

/**
 * Prefer the broker observation clock when it is usable, but never make the
 * chart countdown depend on the optional session-status feed. The countdown
 * model is already anchored to one concrete candle and rejects an elapsed
 * candle, so falling back to the browser clock cannot manufacture timers while
 * a market is closed.
 */
export function countdownClockNow(
  status: MarketSessionStatus | null | undefined,
  clientNow: number,
): number {
  if (status == null || status.observedAt <= 0 || status.receivedAt <= 0) {
    return clientNow;
  }
  const now = marketSessionNow(status, clientNow);
  return Number.isFinite(now) && now >= 0 ? now : clientNow;
}
