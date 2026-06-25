/**
 * GeometryCache — caches projected coordinates and bounding boxes per drawing.
 *
 * Invalidates when drawing point geometry changes or viewport changes.
 * Frame-local — cleared at the start of each render frame.
 */
import type { Drawing, Point } from "@/types";

export interface CachedGeometry {
  /** Projected pixel coordinates for each point. */
  projected: ({ x: number; y: number } | null)[];
  /** Bounding box in pixel space (or null if unprojectable). */
  bbox: { x: number; y: number; w: number; h: number } | null;
  /** The drawing id this cache entry belongs to. */
  drawingId: string;
  /** Content hash at time of caching. */
  hash: string;
}

export class GeometryCache {
  private cache = new Map<string, CachedGeometry>();

  /** Hash a drawing's points for change detection. */
  static hash(d: Drawing): string {
    let h = d.id + ":" + d.points.length;
    for (const pt of d.points) {
      h += "," + pt.time.toFixed(0) + "," + pt.price.toFixed(4);
    }
    return h;
  }

  /** Get or compute cached geometry for a drawing. */
  get(
    d: Drawing,
    toX: (t: number) => number | null,
    toY: (p: number) => number | null,
  ): CachedGeometry {
    const hash = GeometryCache.hash(d);
    const entry = this.cache.get(d.id);
    if (entry && entry.hash === hash) return entry;

    const projected = d.points.map((pt) => {
      const x = toX(pt.time), y = toY(pt.price);
      return x != null && y != null ? { x, y } : null;
    });

    let bbox: CachedGeometry["bbox"] = null;
    const valid = projected.filter((p): p is { x: number; y: number } => p != null);
    if (valid.length > 0) {
      const xs = valid.map((p) => p.x), ys = valid.map((p) => p.y);
      bbox = {
        x: Math.min(...xs), y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
      };
    }

    const result: CachedGeometry = { projected, bbox, drawingId: d.id, hash };
    this.cache.set(d.id, result);
    return result;
  }

  /** Clear the cache (call at frame start). */
  nextFrame(): void {
    this.cache.clear();
  }
}
