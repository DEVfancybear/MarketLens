import type {
  DrawingDataBar,
  DrawingDataSample,
  DrawingDataTick,
} from "../../../../types/drawing";

/** TradingView volume-profile drawings use fewer than 5,000 lower-TF bars. */
export const MAX_DRAWING_DATA_SUB_BARS = 5_000;

/** Tick snapshots are useful when available, but must remain persistence-safe. */
export const MAX_DRAWING_DATA_TICKS = 20_000;
const INVALID_DETAIL_SCAN_SLACK = 256;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizedBar(value: unknown): DrawingDataBar | null {
  if (
    !isRecord(value) ||
    !finite(value.time) ||
    !finite(value.open) ||
    !finite(value.high) ||
    !finite(value.low) ||
    !finite(value.close) ||
    !finite(value.volume)
  ) {
    return null;
  }
  return {
    time: value.time,
    open: value.open,
    high: value.high,
    low: value.low,
    close: value.close,
    volume: Math.max(0, value.volume),
  };
}

function sanitizedTick(value: unknown): DrawingDataTick | null {
  if (!isRecord(value) || !finite(value.price)) return null;
  if (value.time !== undefined && !finite(value.time)) return null;
  if (value.volume !== undefined && !finite(value.volume)) return null;
  if (
    value.direction !== undefined &&
    value.direction !== "up" &&
    value.direction !== "down"
  ) {
    return null;
  }
  return {
    ...(finite(value.time) ? { time: value.time } : {}),
    price: value.price,
    ...(finite(value.volume) ? { volume: Math.max(0, value.volume) } : {}),
    ...(value.direction === "up" || value.direction === "down"
      ? { direction: value.direction }
      : {}),
  };
}

/**
 * Sanitizes the immutable drawing snapshot and retains the newest bounded
 * lower-timeframe/tick detail. The shared helper keeps capture and persistence
 * boundaries from applying subtly different limits.
 */
export function sanitizeDrawingDataSamples(
  values: readonly unknown[],
  maxSamples: number,
): DrawingDataSample[] {
  const candidates = values.slice(-Math.max(0, Math.floor(maxSamples)));
  const result: Array<DrawingDataSample | null> = Array(candidates.length).fill(null);
  let remainingSubBars = MAX_DRAWING_DATA_SUB_BARS;
  let remainingTicks = MAX_DRAWING_DATA_TICKS;

  // Walk newest-to-oldest so a bounded payload retains the detail nearest the
  // active end of an anchored profile.
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index];
    const bar = sanitizedBar(candidate);
    if (!bar || !isRecord(candidate)) continue;
    const sample: DrawingDataSample = bar;

    if (Array.isArray(candidate.subBars)) {
      const raw = remainingSubBars > 0
        ? candidate.subBars.slice(
            -(remainingSubBars + INVALID_DETAIL_SCAN_SLACK),
          )
        : [];
      const valid = raw.flatMap((value) => {
        const nested = sanitizedBar(value);
        return nested ? [nested] : [];
      });
      const retained = remainingSubBars > 0
        ? valid.slice(-remainingSubBars)
        : [];
      remainingSubBars -= retained.length;
      sample.subBars = retained;
      sample.subBarsComplete =
        candidate.subBarsComplete !== false &&
        raw.length === candidate.subBars.length &&
        valid.length === candidate.subBars.length &&
        retained.length === valid.length;
    }

    if (Array.isArray(candidate.ticks)) {
      const raw = remainingTicks > 0
        ? candidate.ticks.slice(
            -(remainingTicks + INVALID_DETAIL_SCAN_SLACK),
          )
        : [];
      const valid = raw.flatMap((value) => {
        const tick = sanitizedTick(value);
        return tick ? [tick] : [];
      });
      const retained = remainingTicks > 0
        ? valid.slice(-remainingTicks)
        : [];
      remainingTicks -= retained.length;
      sample.ticks = retained;
      sample.ticksComplete =
        candidate.ticksComplete === true &&
        raw.length === candidate.ticks.length &&
        valid.length === candidate.ticks.length &&
        retained.length === valid.length;
    }

    result[index] = sample;
  }

  return result.flatMap((sample) => (sample ? [sample] : []));
}
