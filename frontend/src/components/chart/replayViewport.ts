import { RIGHT_OFFSET_BARS } from "./chartVisualProfile";

export type LogicalRangeLike = {
  from: number;
  to: number;
};

export const REPLAY_VIEWPORT_FALLBACK_SPAN_BARS = 120;

function isFiniteLogicalRange(
  range: LogicalRangeLike | null | undefined,
): range is LogicalRangeLike {
  return (
    !!range &&
    Number.isFinite(range.from) &&
    Number.isFinite(range.to) &&
    range.to > range.from
  );
}

export function replayRangeIntersectsData(
  range: LogicalRangeLike | null | undefined,
  dataLength: number,
): boolean {
  if (dataLength <= 0 || !isFiniteLogicalRange(range)) return false;
  const first = 0;
  const last = dataLength - 1;
  return range.to >= first && range.from <= last;
}

export function shouldRealignReplayViewport(
  range: LogicalRangeLike | null | undefined,
  dataLength: number,
): boolean {
  return dataLength > 0 && !replayRangeIntersectsData(range, dataLength);
}

/** Presentation-only snap for turning a chart x-coordinate time into a UTC request. */
export function nearestReplayCandidateIndex(times: number[], requestedTime: number): number {
  if (times.length === 0) return -1;
  let low = 0;
  let high = times.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] < requestedTime) low = mid + 1;
    else high = mid - 1;
  }
  if (low <= 0) return 0;
  if (low >= times.length) return times.length - 1;
  return Math.abs(times[low - 1] - requestedTime) <= Math.abs(times[low] - requestedTime)
    ? low - 1
    : low;
}

export function latestReplayLogicalRange(
  dataLength: number,
  currentRange: LogicalRangeLike | null | undefined,
  rightOffset = RIGHT_OFFSET_BARS,
): LogicalRangeLike | null {
  if (dataLength <= 0) return null;
  const currentSpan = isFiniteLogicalRange(currentRange)
    ? currentRange.to - currentRange.from
    : REPLAY_VIEWPORT_FALLBACK_SPAN_BARS;
  const span = Math.max(10, currentSpan);
  const to = dataLength - 1 + rightOffset;
  return { from: to - span, to };
}
