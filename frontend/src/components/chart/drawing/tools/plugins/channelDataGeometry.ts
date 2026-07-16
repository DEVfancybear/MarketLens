import type { Drawing, Point } from "../../../../../types";

export interface ChannelDataLine {
  a: Point;
  b: Point;
}

/**
 * Canonical channel line in chart data coordinates.
 *
 * The third anchor defines a second line through itself with the same
 * price/time slope as the baseline. Rendering and technical-alert snapshots
 * both consume this function so a viewport or scale change cannot make the
 * visible boundary diverge from the armed boundary.
 */
export function channelDataLine(
  drawing: Pick<Drawing, "points">,
  ratio: number,
): ChannelDataLine | null {
  const [first, second, offsetAnchor] = drawing.points;
  if (
    !first ||
    !second ||
    !offsetAnchor ||
    first.time === second.time ||
    !Number.isFinite(ratio)
  ) {
    return null;
  }
  const slope = (second.price - first.price) / (second.time - first.time);
  const baselineAtOffsetTime = first.price + slope * (offsetAnchor.time - first.time);
  const offset = (offsetAnchor.price - baselineAtOffsetTime) * ratio;
  const a = { ...first, price: first.price + offset };
  const b = { ...second, price: second.price + offset };
  return [a.price, b.price].every(Number.isFinite) ? { a, b } : null;
}
