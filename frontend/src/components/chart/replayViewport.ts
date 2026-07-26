import { RIGHT_OFFSET_BARS } from "./chartVisualProfile";

export type LogicalRangeLike = {
  from: number;
  to: number;
};

export const REPLAY_VIEWPORT_FALLBACK_SPAN_BARS = 120;
export const REPLAY_VIEWPORT_MIN_SPAN_BARS = 40;

export function shouldInitializeReplayViewport(
  activeSessionId: string | null | undefined,
  initializedSessionId: string | null | undefined,
  dataLength: number,
): boolean {
  return dataLength > 0 && !!activeSessionId && activeSessionId !== initializedSessionId;
}

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

/** Keep a Replay selector attached to the same UTC area when its candle series changes. */
export function reconcileReplayPreviewIndex(
  times: number[],
  previousTime: number | null,
  previousIndex: number | null,
): number | null {
  if (times.length === 0) return null;
  if (previousTime != null && Number.isFinite(previousTime)) {
    const nearest = nearestReplayCandidateIndex(times, previousTime);
    return nearest >= 0 ? nearest : null;
  }
  if (previousIndex == null) return null;
  return Math.max(0, Math.min(times.length - 1, previousIndex));
}

export function latestReplayLogicalRange(
  dataLength: number,
  currentRange: LogicalRangeLike | null | undefined,
  rightOffset = RIGHT_OFFSET_BARS,
): LogicalRangeLike | null {
  if (dataLength <= 0) return null;
  const currentSpan = isFiniteLogicalRange(currentRange)
    ? currentRange.to - currentRange.from
    : initialReplaySpan(dataLength, rightOffset);
  const span = Math.max(10, currentSpan);
  const to = dataLength - 1 + rightOffset;
  return { from: to - span, to };
}

/**
 * Give a newly activated Replay session a stable candle width without
 * manufacturing a large empty history area. Sparse first-day sessions retain
 * a 40-bar minimum so one candle stays readable; partially revealed sessions
 * use their actual data length plus symmetric whitespace; deep histories stay
 * capped to the latest 120-bar TradingView-style window.
 */
export function initialReplayLogicalRange(
  dataLength: number,
  rightOffset = RIGHT_OFFSET_BARS,
): LogicalRangeLike | null {
  if (dataLength <= 0) return null;
  const to = dataLength - 1 + rightOffset;
  return { from: to - initialReplaySpan(dataLength, rightOffset), to };
}

function initialReplaySpan(dataLength: number, rightOffset: number): number {
  return Math.min(
    REPLAY_VIEWPORT_FALLBACK_SPAN_BARS,
    Math.max(
      REPLAY_VIEWPORT_MIN_SPAN_BARS,
      dataLength - 1 + Math.max(0, rightOffset) * 2,
    ),
  );
}
