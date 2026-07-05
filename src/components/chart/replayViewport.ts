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
