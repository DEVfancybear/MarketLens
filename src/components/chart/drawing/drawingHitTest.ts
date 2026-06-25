/**
 * DrawingHitTest — pure hit-testing for drawing objects.
 *
 * Delegates to per-tool adapters via getAdapter(). No giant switch.
 * To add a tool, register an adapter in adapters.ts — this file never changes.
 *
 * Given a set of drawings and a (time,price) point, returns the best
 * hit candidate with target discrimination and pixel distance.
 */
import type { Drawing, Point } from "@/types";
import { getAdapter } from "./ToolAdapter";

// Import adapters to trigger registration.
import "./adapters";

export type HitTestProjector = (v: number) => number | null;

/** Part of the drawing that was hit + pixel distance from pointer. */
export type HitResult = {
  drawing: Drawing;
  target: "body" | "p1" | "p2" | "segment" | "label";
  /** Pixel distance from the pointer to the hit target. */
  distance: number;
};

/** Priority ordering: lower = more important. */
const TARGET_PRIORITY: Record<HitResult["target"], number> = {
  p1: 0,
  p2: 0,
  segment: 1,
  label: 2,
  body: 3,
};

export function hitTest(
  drawings: Drawing[],
  p: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;

  // Collect all viable hits across all visible drawings.
  const all: { drawing: Drawing; candidates: HitResult[] }[] = [];
  for (const d of drawings) {
    if (d.visible === false) continue;
    const adapter = getAdapter(d.tool);
    if (!adapter) continue;
    const candidates = adapter.hitTest(d, px, py, toX, toY);
    if (candidates.length > 0) all.push({ drawing: d, candidates });
  }

  if (all.length === 0) return null;

  // Pick best: highest zIndex first, then target priority, then distance.
  all.sort((a, b) => (a.drawing.zIndex ?? 0) - (b.drawing.zIndex ?? 0));

  let best: HitResult | null = null;
  for (const { drawing, candidates } of all) {
    let bestForDrawing: HitResult | null = null;
    for (const c of candidates) {
      if (
        !bestForDrawing ||
        TARGET_PRIORITY[c.target] < TARGET_PRIORITY[bestForDrawing.target] ||
        (TARGET_PRIORITY[c.target] === TARGET_PRIORITY[bestForDrawing.target] &&
          c.distance < bestForDrawing.distance)
      ) {
        bestForDrawing = c;
      }
    }
    if (bestForDrawing) {
      if (!best || (drawing.zIndex ?? 0) > (best.drawing.zIndex ?? 0)) {
        best = bestForDrawing;
      }
    }
  }

  return best;
}
