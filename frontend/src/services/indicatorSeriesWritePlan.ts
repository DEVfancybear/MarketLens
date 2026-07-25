export interface IndicatorWritePoint {
  time: number;
  value: number;
  color?: string;
}

export type IndicatorSeriesWritePlan = "none" | "update-latest" | "append" | "replace";

function pointsEqual(a: IndicatorWritePoint, b: IndicatorWritePoint) {
  return a.time === b.time && a.value === b.value && a.color === b.color;
}

function prefixEqual(
  previous: readonly IndicatorWritePoint[],
  next: readonly IndicatorWritePoint[],
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    if (!pointsEqual(previous[index], next[index])) return false;
  }
  return true;
}

/**
 * Selects the cheapest correct Lightweight Charts write for derived data.
 * A latest-point write is safe only when every preceding projected point is
 * value-equal; custom/Pine outputs therefore fall back to replacement whenever
 * historical output changes.
 */
export function resolveIndicatorSeriesWritePlan(
  previous: readonly IndicatorWritePoint[],
  next: readonly IndicatorWritePoint[],
): IndicatorSeriesWritePlan {
  if (previous.length === next.length) {
    if (prefixEqual(previous, next, next.length)) return "none";
    const lastIndex = next.length - 1;
    if (
      lastIndex >= 0 &&
      previous[lastIndex].time === next[lastIndex].time &&
      prefixEqual(previous, next, lastIndex)
    ) {
      return "update-latest";
    }
    return "replace";
  }

  if (
    next.length === previous.length + 1 &&
    prefixEqual(previous, next, previous.length)
  ) {
    return "append";
  }

  return "replace";
}

/**
 * An empty native pane has no price range. Its first real write must restore
 * autoscale explicitly so the series is visible immediately even when the
 * pane inherited a transient/manual scale state during creation.
 */
export function shouldInitializeIndicatorPaneAutoScale(
  previous: readonly IndicatorWritePoint[],
  next: readonly IndicatorWritePoint[],
): boolean {
  return previous.length === 0 && next.length > 0;
}
