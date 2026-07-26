import type { Candle } from "@/types";
import type { ChartPaneState } from "@/store/replayLayoutStore";

const EMPTY_CANDLES: Candle[] = [];
const PERSISTED_SERIES_VERSION = 1;
const PERSISTED_SERIES_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_CANDLES = 600;

interface SeriesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface PersistedSeriesEnvelope {
  version: typeof PERSISTED_SERIES_VERSION;
  savedAt: number;
  snapshot: ChartSeriesSnapshot;
}

export interface ChartSeriesSnapshot {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  source: "live" | "replay";
}

/**
 * Keep the last live frame visible while an active chart remounts as a preview.
 * A keyed market-data series replaces this fallback as soon as it is available.
 */
export function selectPaneLiveSeries(
  pane: Pick<ChartPaneState, "symbol" | "timeframe">,
  current: Candle[],
  retained?: ChartSeriesSnapshot,
): Candle[] {
  if (current.length > 0) return current;
  if (
    retained?.source === "live" &&
    retained.symbol === pane.symbol &&
    retained.timeframe === pane.timeframe
  ) {
    return retained.candles;
  }
  return EMPTY_CANDLES;
}

function persistedSeriesKey(
  layoutId: string,
  pane: Pick<ChartPaneState, "id" | "symbol" | "timeframe">,
): string {
  return [
    "smc",
    "chart-series",
    PERSISTED_SERIES_VERSION,
    layoutId,
    pane.id,
    pane.symbol,
    pane.timeframe,
  ].map(encodeURIComponent).join(":");
}

function isCandle(value: unknown): value is Candle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candle = value as Partial<Candle>;
  return [
    candle.time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ].every(Number.isFinite);
}

/**
 * Persist a bounded live frame so a browser refresh can paint every pane while
 * its authoritative history request is still warming up.
 */
export function persistPaneLiveSeries(
  storage: SeriesStorage | null | undefined,
  layoutId: string,
  pane: Pick<ChartPaneState, "id" | "symbol" | "timeframe">,
  snapshot: ChartSeriesSnapshot,
  now = Date.now(),
): void {
  if (
    !storage ||
    snapshot.source !== "live" ||
    snapshot.symbol !== pane.symbol ||
    snapshot.timeframe !== pane.timeframe ||
    snapshot.candles.length === 0
  ) {
    return;
  }
  const envelope: PersistedSeriesEnvelope = {
    version: PERSISTED_SERIES_VERSION,
    savedAt: now,
    snapshot: {
      ...snapshot,
      candles: snapshot.candles.slice(-MAX_PERSISTED_CANDLES),
    },
  };
  try {
    storage.setItem(persistedSeriesKey(layoutId, pane), JSON.stringify(envelope));
  } catch {
    // Storage may be unavailable or full. Live history remains authoritative.
  }
}

export function restorePaneLiveSeries(
  storage: SeriesStorage | null | undefined,
  layoutId: string,
  pane: Pick<ChartPaneState, "id" | "symbol" | "timeframe">,
  now = Date.now(),
): ChartSeriesSnapshot | undefined {
  if (!storage || !pane.symbol) return undefined;
  const key = persistedSeriesKey(layoutId, pane);
  try {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    const envelope = JSON.parse(raw) as Partial<PersistedSeriesEnvelope>;
    const snapshot = envelope.snapshot;
    const valid =
      envelope.version === PERSISTED_SERIES_VERSION &&
      typeof envelope.savedAt === "number" &&
      now - envelope.savedAt >= 0 &&
      now - envelope.savedAt <= PERSISTED_SERIES_TTL_MS &&
      snapshot?.source === "live" &&
      snapshot.symbol === pane.symbol &&
      snapshot.timeframe === pane.timeframe &&
      Array.isArray(snapshot.candles) &&
      snapshot.candles.length > 0 &&
      snapshot.candles.length <= MAX_PERSISTED_CANDLES &&
      snapshot.candles.every(isCandle);
    if (valid) return snapshot;
    storage.removeItem?.(key);
  } catch {
    storage.removeItem?.(key);
  }
  return undefined;
}
