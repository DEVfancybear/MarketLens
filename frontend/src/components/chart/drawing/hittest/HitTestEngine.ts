/**
 * DrawingHitTest — TradingView-style pure hit-testing for drawing objects.
 *
 * Priority:
 *   1. Deliberate handle hit on an already-selected drawing.
 *   2. Body hit — topmost drawing wins, then closest distance.
 *   3. No hit — returns null.
 *
 * Delegates to per-tool adapters via getTool(). No switch statements.
 * Tolerance is in screen pixels (HANDLE_RADIUS/TOL from geometry helpers).
 */
import type { Drawing, Point } from "@/types";
import { getTool, HANDLE_RADIUS } from "../tools/ToolRegistry";
import { hitPriorityScore } from "./hitPriority";

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
  target: "body" | `p${number}`;
  /** Adapter-defined anchor id for anchor hits, -1 for body. */
  anchorIndex?: number;
  /** Pixel distance from the pointer to the hit target. */
  distance: number;
};

export interface HitTestOptions {
  /** Anchors are resize affordances only after their drawing is selected. */
  selectedDrawingIds?: ReadonlySet<string>;
  /** Pointer-aware precision keeps touch usable without swallowing compact bodies. */
  pointerType?: string;
}

const PRECISE_ANCHOR_RADIUS = {
  mouse: 8,
  pen: 10,
  touch: 14,
} as const;

// Shared handles render as a 4 px radius circle (Position uses a comparable
// 7 px square). When two expanded hit discs overlap, only a hit this close to
// one visible handle is unambiguous enough to resize.
const VISUAL_HANDLE_SLOP = 6;
const EQUAL_DISTANCE_EPSILON = 2;

function pointerAnchorRadius(pointerType: string | undefined): number {
  if (pointerType === "touch") return PRECISE_ANCHOR_RADIUS.touch;
  if (pointerType === "pen") return PRECISE_ANCHOR_RADIUS.pen;
  return PRECISE_ANCHOR_RADIUS.mouse;
}

export function hitTest(
  drawings: Drawing[],
  p: Point,
  toX: HitTestProjector,
  toY: HitTestProjector,
  options?: HitTestOptions,
): HitResult | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;

  let best: HitResult | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

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

    const candidates = adapter.hitTest(d, px, py, toX, toY).map((c) => {
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

      return { ...c, anchorIndex: anchorIdx };
    });

    let interactionCandidates = candidates;
    if (options) {
      const bodyCandidates = candidates.filter(
        (candidate) => candidate.target === "body",
      );
      const anchorCandidates = candidates
        .filter((candidate) => candidate.target !== "body")
        .sort((a, b) => a.distance - b.distance);
      const selected = options.selectedDrawingIds?.has(d.id) ?? false;

      if (!selected) {
        // The first drag on an unselected object moves the whole object. If an
        // adapter exposes anchors only, normalize the closest hit to a body hit
        // instead of unexpectedly resizing before selection is established.
        interactionCandidates = bodyCandidates.length > 0
          ? bodyCandidates
          : anchorCandidates.length > 0
            ? [{ ...anchorCandidates[0], target: "body", anchorIndex: -1 }]
            : [];
      } else if (bodyCandidates.length > 0) {
        const radius = pointerAnchorRadius(options.pointerType);
        const closeAnchors = anchorCandidates.filter(
          (candidate) => candidate.distance <= radius,
        );
        const first = closeAnchors[0];
        const second = closeAnchors[1];
        const ambiguousOverlap = !!first && !!second &&
          first.distance > VISUAL_HANDLE_SLOP &&
          Math.abs(second.distance - first.distance) <= EQUAL_DISTANCE_EPSILON;

        // Adapter radii remain generous for touch discovery, but compact body
        // interiors stay draggable where left/right or corner discs overlap.
        // Exact and near-handle hits retain normal resize priority.
        interactionCandidates = first && !ambiguousOverlap
          ? [...bodyCandidates, ...closeAnchors]
          : bodyCandidates;
      }
    }

    for (const hit of interactionCandidates) {
      const score = hitPriorityScore(hit, d.zIndex ?? 0);
      if (score > bestScore) {
        best = hit;
        bestScore = score;
      }
    }
  }

  return best;
}
