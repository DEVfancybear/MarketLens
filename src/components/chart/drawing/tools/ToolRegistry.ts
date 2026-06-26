/**
 * ToolRegistry — universal DrawingAdapter interface and registry.
 *
 * Every drawing tool implements the DrawingAdapter interface. The renderer,
 * hit-tester, and interaction manager delegate to the adapter via polymorphism.
 * No switch statements. No tool-specific logic outside adapters.
 *
 * Adding a new tool: implement DrawingAdapter, call registerTool(), done.
 */
import type { Drawing, Point } from "@/types";
import type { DrawingTool } from "@/types";
import type { HitResult, HitTestProjector } from "../hittest/HitTestEngine";
import type { Projector } from "../drawingRenderer";
import {
  defaultMovePoints as geoDefaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
  distToRect,
  projectPoint,
} from "../geometry/helpers";

// Re-export geometry helpers.
export {
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
  distToRect,
  projectPoint,
} from "../geometry/helpers";

// Re-export defaultMovePoints for backward compat.
export { defaultMovePoints as defaultMovePoints } from "../geometry/helpers";

// ---------------------------------------------------------------------------
// DrawingAdapter — universal polymorphic interface
// ---------------------------------------------------------------------------

export interface Anchor {
  index: number;
  x: number | null;
  y: number | null;
  target: HitResult["target"];
}

export interface DrawingAdapter {
  readonly tool: DrawingTool;
  readonly minPoints: number;

  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ): void;
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[];
  movePoints(
    origPoints: Point[],
    pointer: Point,
    dragTarget: "p1" | "p2" | "body",
    dragStart: Point,
  ): Point[];
  boundingBox(
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): { x: number; y: number; w: number; h: number } | null;

  /** Translate all points by the delta from dragStart to pointer. */
  move(origPoints: Point[], pointer: Point, dragStart: Point): Point[];
  /** Move a single anchor point to a new position. */
  moveAnchor(origPoints: Point[], index: number, pointer: Point): Point[];
  /** Return all interactive handle positions. */
  getAnchors(
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): Anchor[];
}

// ---------------------------------------------------------------------------
// Default implementations (derived from movePoints)
// ---------------------------------------------------------------------------

export function defaultMove(
  origPoints: Point[],
  pointer: Point,
  dragStart: Point,
): Point[] {
  const dt = pointer.time - dragStart.time;
  const dp = pointer.price - dragStart.price;
  return origPoints.map((pt) => ({ time: pt.time + dt, price: pt.price + dp }));
}

export function defaultMoveAnchor(
  origPoints: Point[],
  index: number,
  pointer: Point,
): Point[] {
  const next = origPoints.map((pt) => ({ ...pt }));
  if (index >= 0 && index < next.length) {
    next[index] = { time: pointer.time, price: pointer.price };
  }
  return next;
}

export function defaultGetAnchors(
  d: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
): Anchor[] {
  return d.points.map((pt, i) => {
    const x = toX(pt.time);
    const y = toY(pt.price);
    return { index: i, x, y, target: i === 0 ? "p1" : i === 1 ? "p2" : "body" };
  });
}

// ---------------------------------------------------------------------------
// createAdapter — wraps a simple tool object into a full DrawingAdapter
// ---------------------------------------------------------------------------

export interface SimpleTool {
  readonly tool: DrawingTool;
  readonly minPoints: number;
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ): void;
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[];
  movePoints(
    origPoints: Point[],
    pointer: Point,
    dragTarget: "p1" | "p2" | "body",
    dragStart: Point,
  ): Point[];
  boundingBox(
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): { x: number; y: number; w: number; h: number } | null;
  move?(origPoints: Point[], pointer: Point, dragStart: Point): Point[];
  moveAnchor?(origPoints: Point[], index: number, pointer: Point): Point[];
  getAnchors?(
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): Anchor[];
}

export function createAdapter(t: SimpleTool): DrawingAdapter {
  return {
    ...t,
    move: t.move ?? ((orig, ptr, start) => defaultMove(orig, ptr, start)),
    moveAnchor:
      t.moveAnchor ?? ((orig, idx, ptr) => defaultMoveAnchor(orig, idx, ptr)),
    getAnchors:
      t.getAnchors ?? ((d, toX, toY) => defaultGetAnchors(d, toX, toY)),
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<DrawingTool, DrawingAdapter>();

/** Register a tool. Automatically wraps simple tools with defaults. */
export function registerTool(t: DrawingAdapter | SimpleTool): void {
  const adapter: DrawingAdapter = 'move' in t && 'moveAnchor' in t && 'getAnchors' in t
    ? t as DrawingAdapter
    : createAdapter(t as SimpleTool);
  registry.set(adapter.tool, adapter);
}
export function getTool(tool: DrawingTool): DrawingAdapter | undefined {
  return registry.get(tool);
}

export function allTools(): DrawingAdapter[] {
  return [...registry.values()];
}

// Backward-compat alias.
/** @deprecated Use DrawingAdapter instead. */
export type DrawingToolPlugin = SimpleTool;
