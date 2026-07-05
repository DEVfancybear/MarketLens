/**
 * SpatialIndex — simple quadtree for fast spatial queries on drawings.
 *
 * Only indexes by bounding box — does not replace hitTest.
 * Used to filter candidate drawings before calling per-tool hitTest().
 */
import type { Drawing } from "@/types";
import type { HitTestProjector } from "../hittest/HitTestEngine";

interface Entry {
  drawing: Drawing;
  bbox: { x: number; y: number; w: number; h: number };
}

export class SpatialIndex {
  private entries: Entry[] = [];

  /** Rebuild the index from the current drawing set. */
  rebuild(
    drawings: Drawing[],
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): void {
    this.entries = [];
    for (const d of drawings) {
      if (d.visible === false) continue;
      const points = d.points.map((pt) => {
        const x = toX(pt.time),
          y = toY(pt.price);
        // Fallback to 0 so off-screen drawings are still indexed.
        return { x: x ?? 0, y: y ?? 0 };
      });
      const xs = points.map((p) => p.x),
        ys = points.map((p) => p.y);
      this.entries.push({
        drawing: d,
        bbox: {
          x: Math.min(...xs) - 10,
          y: Math.min(...ys) - 10,
          w: Math.max(...xs) - Math.min(...xs) + 20,
          h: Math.max(...ys) - Math.min(...ys) + 20,
        },
      });
    }
    // Sort by zIndex (descending) — topmost first.
    this.entries.sort(
      (a, b) => (b.drawing.zIndex ?? 0) - (a.drawing.zIndex ?? 0),
    );
  }

  /** Query drawings whose bounding box contains (px, py). */
  query(px: number, py: number): Drawing[] {
    const results: Drawing[] = [];
    for (const e of this.entries) {
      if (
        px >= e.bbox.x &&
        px <= e.bbox.x + e.bbox.w &&
        py >= e.bbox.y &&
        py <= e.bbox.y + e.bbox.h
      ) {
        results.push(e.drawing);
      }
    }
    return results;
  }

  /** Query drawings whose bounding box intersects the viewport. */
  queryViewport(vx: number, vy: number, vw: number, vh: number): Drawing[] {
    const results: Drawing[] = [];
    for (const e of this.entries) {
      if (
        e.bbox.x + e.bbox.w >= vx &&
        e.bbox.x <= vx + vw &&
        e.bbox.y + e.bbox.h >= vy &&
        e.bbox.y <= vy + vh
      ) {
        results.push(e.drawing);
      }
    }
    return results;
  }
}
