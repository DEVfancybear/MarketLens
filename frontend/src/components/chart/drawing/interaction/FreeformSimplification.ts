import type { Point } from "../../../../types/drawing";

type XYPoint = { point: Point; x: number; y: number };

/**
 * Canvas2D applies one width to an entire stroked segment. Keep enough pen
 * samples that a gradual pressure ramp cannot collapse into one constant-width
 * segment during geometric simplification.
 */
const MAX_SIMPLIFIED_PRESSURE_DELTA = 0.1;
const PRESSURE_DEVIATION_TOLERANCE = 0.04;

function distanceToLine(point: XYPoint, first: XYPoint, last: XYPoint): number {
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - first.x, point.y - first.y);
  const t = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (first.x + t * dx), point.y - (first.y + t * dy));
}

function normalizedPressure(point: XYPoint): number | null {
  const pressure = point.point.pressure;
  return Number.isFinite(pressure)
    ? Math.max(0, Math.min(1, Number(pressure)))
    : null;
}

function pressureSplit(
  points: readonly XYPoint[],
  first: number,
  last: number,
): { index: number; score: number } | null {
  if (last - first <= 1) return null;
  const firstPressure = normalizedPressure(points[first]);
  const lastPressure = normalizedPressure(points[last]);

  // Preserve a transition between historical pressure-less samples and pen
  // samples. Choose the edge of the finite run so recursion can simplify each
  // homogeneous side independently.
  if (firstPressure == null || lastPressure == null) {
    if (firstPressure == null && lastPressure == null) {
      const index = points.findIndex(
        (point, current) =>
          current > first && current < last && normalizedPressure(point) != null,
      );
      return index >= 0 ? { index, score: Number.POSITIVE_INFINITY } : null;
    }
    if (firstPressure != null) {
      for (let index = last - 1; index > first; index -= 1) {
        if (normalizedPressure(points[index]) != null) {
          return { index, score: Number.POSITIVE_INFINITY };
        }
      }
    } else {
      for (let index = first + 1; index < last; index += 1) {
        if (normalizedPressure(points[index]) != null) {
          return { index, score: Number.POSITIVE_INFINITY };
        }
      }
    }
    return null;
  }

  let bestIndex = -1;
  let bestScore = 1;
  const span = last - first;
  for (let index = first + 1; index < last; index += 1) {
    const pressure = normalizedPressure(points[index]);
    if (pressure == null) {
      return { index, score: Number.POSITIVE_INFINITY };
    }
    const ratio = (index - first) / span;
    const expected = firstPressure + (lastPressure - firstPressure) * ratio;
    const score = Math.abs(pressure - expected) / PRESSURE_DEVIATION_TOLERANCE;
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }

  // A perfectly linear ramp has zero interpolation error, but it still needs
  // multiple Canvas2D segments because width is not interpolated within one
  // segment. Split near the pressure midpoint until each retained segment has
  // a visually bounded pressure change.
  const spanScore = Math.abs(lastPressure - firstPressure) /
    MAX_SIMPLIFIED_PRESSURE_DELTA;
  if (spanScore > bestScore) {
    const target = (firstPressure + lastPressure) / 2;
    let midpointIndex = -1;
    let midpointDistance = Number.POSITIVE_INFINITY;
    for (let index = first + 1; index < last; index += 1) {
      const pressure = normalizedPressure(points[index]);
      if (pressure == null) continue;
      const distance = Math.abs(pressure - target);
      if (distance < midpointDistance) {
        midpointIndex = index;
        midpointDistance = distance;
      }
    }
    if (midpointIndex >= 0) {
      bestIndex = midpointIndex;
      bestScore = spanScore;
    }
  }

  return bestIndex >= 0 ? { index: bestIndex, score: bestScore } : null;
}

function simplifyRange(points: readonly XYPoint[], first: number, last: number, tolerance: number, keep: Set<number>) {
  let index = -1;
  let maxScore = 1;
  for (let current = first + 1; current < last; current += 1) {
    const score = distanceToLine(points[current], points[first], points[last]) / tolerance;
    if (score > maxScore) {
      maxScore = score;
      index = current;
    }
  }
  const pressure = pressureSplit(points, first, last);
  if (pressure && pressure.score > maxScore) {
    maxScore = pressure.score;
    index = pressure.index;
  }
  if (index < 0) return;
  keep.add(index);
  simplifyRange(points, first, index, tolerance, keep);
  simplifyRange(points, index, last, tolerance, keep);
}

/** Deterministic Ramer-Douglas-Peucker simplification in CSS-pixel space. */
export function simplifyProjectedPoints(
  points: readonly Point[],
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
  tolerance: number,
): Point[] {
  if (points.length <= 2 || tolerance <= 0) return points.map((point) => ({ ...point }));
  const projected = points.map((point) => ({ point, x: toX(point.time), y: toY(point.price) }));
  if (projected.some(({ x, y }) => x == null || y == null)) return points.map((point) => ({ ...point }));
  const screen = projected as XYPoint[];
  const keep = new Set([0, screen.length - 1]);
  simplifyRange(screen, 0, screen.length - 1, tolerance, keep);
  return [...keep].sort((a, b) => a - b).map((index) => ({ ...screen[index].point }));
}
