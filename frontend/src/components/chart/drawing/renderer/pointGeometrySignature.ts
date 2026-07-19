import type { Point } from "@/types";

/**
 * Serialize transient geometry without discarding market precision.
 *
 * Pointer updates are already frame-coalesced. Quantizing here would therefore
 * drop real frames rather than save work: a 5-decimal Forex tick (0.00001), for
 * example, must not share a render signature with the previous price.
 */
export function pointGeometrySignature(point: Point): string {
  const pressure = Number.isFinite(point.pressure)
    ? String(point.pressure)
    : "-";
  return `${String(point.time)},${String(point.price)},${pressure}`;
}
