import type { Point } from "../../../../types/drawing";

type XYPoint = { point: Point; x: number; y: number };

function distanceToLine(point: XYPoint, first: XYPoint, last: XYPoint): number {
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - first.x, point.y - first.y);
  const t = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (first.x + t * dx), point.y - (first.y + t * dy));
}

function simplifyRange(points: readonly XYPoint[], first: number, last: number, tolerance: number, keep: Set<number>) {
  let index = -1;
  let maxDistance = tolerance;
  for (let current = first + 1; current < last; current += 1) {
    const distance = distanceToLine(points[current], points[first], points[last]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = current;
    }
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
