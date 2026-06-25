/**
 * ToolAdapter — plug-in interface for drawing tools.
 *
 * Each drawing tool (trendline, rectangle, circle, etc.) implements this
 * interface. The renderer and hit-tester delegate to the adapter via
 * a type-indexed registry — no giant switch statements.
 *
 * Adding a new tool: implement ToolAdapter, register in ALL_TOOLS, done.
 *
 * Architecture:
 *   render()     → draws the tool on a canvas context
 *   hitTest()    → returns HitResult[] candidates for a pointer position
 *   movePoints() → computes new point positions when dragging
 *   boundingBox()→ returns the pixel bounding box (for dirty region optimization)
 */

import type { Drawing, DrawingTool, Point } from "@/types";
import type { HitResult, HitTestProjector } from "./drawingHitTest";
import type { Projector } from "./drawingRenderer";

// ---------------------------------------------------------------------------
// Shared helpers (exported so adapter implementations can use them)
// ---------------------------------------------------------------------------

export const HANDLE_RADIUS = 10;
export const TOL = 8;

export function pointDist(px: number, py: number, x: number, y: number): number {
  return Math.hypot(px - x, py - y);
}

export function distToSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function distToRect(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const left = Math.min(x1, x2), right = Math.max(x1, x2);
  const top = Math.min(y1, y2), bottom = Math.max(y1, y2);
  if (px >= left && px <= right && py >= top && py <= bottom) return 0;
  return Math.hypot(
    Math.max(left - px, 0, px - right),
    Math.max(top - py, 0, py - bottom),
  );
}

// ---------------------------------------------------------------------------
// ToolAdapter interface
// ---------------------------------------------------------------------------

export interface ToolAdapter {
  /** The tool type this adapter handles. */
  readonly tool: DrawingTool;

  /** Minimum number of points needed to create this drawing. */
  readonly minPoints: number;

  /**
   * Render the drawing onto a canvas context.
   * @param selected - whether the drawing is currently selected (draw handles, thicker line).
   */
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ): void;

  /**
   * Compute all hit candidates for this drawing at the given pixel position.
   * Returns an empty array if nothing was hit.
   */
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[];

  /**
   * Compute new point positions when a drawing is being dragged.
   *
   * @param origPoints - the drawing's points at drag start.
   * @param pointer - the current pointer position (time, price).
   * @param dragTarget - which part is being dragged ("p1" | "p2" | "body").
   * @param dragStart - pointer position when drag started (for body delta).
   * @returns new point positions.
   */
  movePoints(
    origPoints: Point[],
    pointer: Point,
    dragTarget: "p1" | "p2" | "body",
    dragStart: Point,
  ): Point[];

  /**
   * Compute the pixel bounding box of the drawing.
   * Used for dirty-region optimization (future).
   */
  boundingBox(
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): { x: number; y: number; w: number; h: number } | null;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<DrawingTool, ToolAdapter>();

export function registerAdapter(a: ToolAdapter): void {
  registry.set(a.tool, a);
}

export function getAdapter(tool: DrawingTool): ToolAdapter | undefined {
  return registry.get(tool);
}

/** All registered adapters (for iteration). */
export function allAdapters(): ToolAdapter[] {
  return [...registry.values()];
}

// ---------------------------------------------------------------------------
// Default movePoints (works for most tools)
// ---------------------------------------------------------------------------

export function defaultMovePoints(
  origPoints: Point[],
  pointer: Point,
  dragTarget: "p1" | "p2" | "body",
  dragStart: Point,
): Point[] {
  const next = origPoints.map((pt) => ({ ...pt }));

  if (dragTarget === "p1") {
    next[0] = { time: pointer.time, price: pointer.price };
  } else if (dragTarget === "p2" && next.length > 1) {
    next[1] = { time: pointer.time, price: pointer.price };
  } else {
    const dt = pointer.time - dragStart.time;
    const dp = pointer.price - dragStart.price;
    for (let i = 0; i < next.length; i++) {
      next[i] = {
        time: origPoints[i].time + dt,
        price: origPoints[i].price + dp,
      };
    }
  }

  return next;
}
