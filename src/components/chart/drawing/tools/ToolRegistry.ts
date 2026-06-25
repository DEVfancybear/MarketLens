/**
 * ToolRegistry — plug-in interface and registry for drawing tools.
 *
 * Each drawing tool implements the ToolAdapter interface. The renderer
 * and hit-tester delegate to the adapter via a type-indexed registry.
 *
 * Adding a new tool: implement ToolAdapter, call registerAdapter(), done.
 */
import type { Drawing, DrawingTool, Point } from "@/types";
import type { HitResult, HitTestProjector } from "../hittest/HitTestEngine";
import type { Projector } from "../drawingRenderer";

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

export interface ToolAdapter {
  readonly tool: DrawingTool;
  readonly minPoints: number;
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean): void;
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[];
  movePoints(origPoints: Point[], pointer: Point, dragTarget: "p1" | "p2" | "body", dragStart: Point): Point[];
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector): { x: number; y: number; w: number; h: number } | null;
}

const registry = new Map<DrawingTool, ToolAdapter>();

export function registerAdapter(a: ToolAdapter): void {
  registry.set(a.tool, a);
}

export function getAdapter(tool: DrawingTool): ToolAdapter | undefined {
  return registry.get(tool);
}

export function defaultMovePoints(
  origPoints: Point[], pointer: Point,
  dragTarget: "p1" | "p2" | "body", dragStart: Point,
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
      next[i] = { time: origPoints[i].time + dt, price: origPoints[i].price + dp };
    }
  }
  return next;
}
