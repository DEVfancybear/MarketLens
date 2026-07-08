/**
 * SpatialIndex — simple quadtree for fast spatial queries on drawings.
 *
 * Only indexes by bounding box — does not replace hitTest.
 * Used to filter candidate drawings before calling per-tool hitTest().
 */
import type { Drawing } from "@/types";
import type { HitTestProjector } from "../hittest/HitTestEngine";
import { getTool } from "../tools/ToolRegistry";

interface Entry {
  drawing: Drawing;
  bbox: { x: number; y: number; w: number; h: number };
}

function pointFallbackBox(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Entry["bbox"] | null {
  if (!d.points.length) return null;
  const points = d.points.map((pt) => {
    const x = toX(pt.time);
    const y = toY(pt.price);
    return { x: x ?? 0, y: y ?? 0 };
  });
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX - 10,
    y: minY - 10,
    w: Math.max(1, maxX - minX + 20),
    h: Math.max(1, maxY - minY + 20),
  };
}

function normalizeBox(box: Entry["bbox"] | null): Entry["bbox"] | null {
  if (!box) return null;
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !Number.isFinite(box.w) ||
    !Number.isFinite(box.h)
  ) {
    return null;
  }
  const x = box.w < 0 ? box.x + box.w : box.x;
  const y = box.h < 0 ? box.y + box.h : box.y;
  return {
    x,
    y,
    w: Math.max(1, Math.abs(box.w)),
    h: Math.max(1, Math.abs(box.h)),
  };
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
      const adapter = getTool(d.tool);
      const bbox = normalizeBox(
        adapter?.boundingBox(d, toX, toY) ?? pointFallbackBox(d, toX, toY),
      );
      if (!bbox) continue;
      this.entries.push({ drawing: d, bbox });
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
