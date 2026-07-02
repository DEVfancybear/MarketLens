/**
 * DrawingHitTest — TradingView-style pure hit-testing for drawing objects.
 *
 * Priority:
 *   1. Anchor hit (any drawing) — topmost drawing wins, then closest distance.
 *   2. Body hit — topmost drawing wins, then closest distance.
 *   3. No hit — returns null.
 *
 * Delegates to per-tool adapters via getTool(). No switch statements.
 * Tolerance is in screen pixels (HANDLE_RADIUS/TOL from geometry helpers).
 */
import type { Drawing, Point } from "@/types";
import { getTool, HANDLE_RADIUS } from "../tools/ToolRegistry";

// Import adapters to trigger registration.
import "../tools/adapters";

// Extra margin added on top of each adapter's own boundingBox() padding before
// the cheap pre-filter below (see hitTest()) rejects a drawing. Adapters pad
// inconsistently (some by TOL, some less, e.g. TextTool), so this uses the
// largest tolerance constant in the codebase to guarantee the pre-filter can
// never reject a drawing that a full hitTest() would have hit.
const BBOX_MARGIN = HANDLE_RADIUS;

export type HitTestProjector = (v: number) => number | null;

/** Part of the drawing that was hit + pixel distance from pointer. */
export type HitResult = {
  drawing: Drawing;
  /** "body" for line/area hit, or anchor label for handle hit. */
  target: "body" | "p0" | "p1" | "p2" | "p3";
  /** Zero-based index into drawing.points for anchor hits, -1 for body. */
  anchorIndex?: number;
  /** Pixel distance from the pointer to the hit target. */
  distance: number;
};

/** TradingView priority: anchor > body. Primary sort: isAnchor desc, zIndex desc, distance asc. */
function hitScore(h: HitResult, z: number): number {
  const isAnchor = h.target !== "body" ? 1 : 0;
  // Pack priority into a single number for sorting.
  // Higher = better. isAnchor dominates, then zIndex, then -distance.
  return isAnchor * 1e12 + z * 1e6 + (1000 - Math.min(h.distance, 999));
}

export function hitTest(
  drawings: Drawing[],
  p: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;

  // Collect all candidate hits across all visible drawings.
  const allCandidates: { hit: HitResult; zIndex: number }[] = [];

  for (const d of drawings) {
    if (d.visible === false) continue;
    const adapter = getTool(d.tool);
    if (!adapter) continue;

    // Cheap reject before the (potentially per-tool-expensive) full hitTest:
    // skip drawings whose bounding box, padded by a safety margin, can't
    // possibly contain the click. `null` means "can't compute right now" —
    // fall through to the full test rather than risk a false reject.
    const box = adapter.boundingBox(d, toX, toY);
    if (box) {
      const left = box.x - BBOX_MARGIN;
      const top = box.y - BBOX_MARGIN;
      const right = box.x + box.w + BBOX_MARGIN;
      const bottom = box.y + box.h + BBOX_MARGIN;
      if (px < left || px > right || py < top || py > bottom) continue;
    }

    const candidates = adapter.hitTest(d, px, py, toX, toY);
    for (const c of candidates) {
      // Resolve anchor index from the adapter.
      const isAnchor = c.target !== "body";
      let anchorIdx = c.anchorIndex ?? -1;
      if (isAnchor) {
        if (anchorIdx < 0) {
          const anchors = adapter.getAnchors(d, toX, toY);
          const found = anchors.find((a) => a.target === c.target);
          anchorIdx = found
            ? found.index
            : c.target === "p1"
              ? 0
              : c.target === "p2"
                ? 1
                : -1;
        }
      }

      allCandidates.push({
        hit: { ...c, anchorIndex: anchorIdx },
        zIndex: d.zIndex ?? 0,
      });
    }
  }

  if (allCandidates.length === 0) {
    return null;
  }

  // Sort by TradingView priority: anchor > body, then topmost drawing, then closest.
  allCandidates.sort(
    (a, b) => hitScore(b.hit, b.zIndex) - hitScore(a.hit, a.zIndex),
  );

  const best = allCandidates[0].hit;
  return best;
}
