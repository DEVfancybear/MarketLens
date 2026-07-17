export interface VisibleRangeReader {
  getVisibleRange(): { from: unknown; to: unknown } | null;
}

export interface NumericVisibleRange {
  from: number;
  to: number;
}

/**
 * `lightweight-charts` 5.2 can briefly keep a logical range after its time
 * points have been cleared. During that transition `getVisibleRange()` throws
 * its internal null assertion instead of returning `null` as its API promises.
 */
export function readSmcVisibleRange(
  timeScale: VisibleRangeReader,
): NumericVisibleRange | null {
  let range: ReturnType<VisibleRangeReader["getVisibleRange"]>;
  try {
    range = timeScale.getVisibleRange();
  } catch (error) {
    if (error instanceof Error && error.message === "Value is null") {
      return null;
    }
    throw error;
  }

  if (
    range == null ||
    typeof range.from !== "number" ||
    typeof range.to !== "number" ||
    !Number.isFinite(range.from) ||
    !Number.isFinite(range.to)
  ) {
    return null;
  }

  return { from: range.from, to: range.to };
}
