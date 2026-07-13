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
import {
  DRAWING_TOOLS,
  getDrawingToolManifestEntry,
  type DrawingToolManifestEntry,
} from "../../../../types/drawingToolManifest";
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
  /** Adapter-defined handle id. For most tools this is a point index; position
   *  tools use virtual ids for their six TradingView-style handles. */
  index: number;
  x: number | null;
  y: number | null;
  target: HitResult["target"];
}

/** Runtime-only market constraints supplied by the chart interaction root. */
export interface DrawingAdapterInteractionContext {
  tickSize?: number;
  barIntervalSeconds?: number;
  /** Current logical bar width, used for screen-space minimum resize spans. */
  barSpacing?: number;
  candles?: readonly { time: number }[];
}

export interface DrawingAdapter {
  readonly tool: DrawingTool;
  readonly minPoints: number;
  /** Fixed total point count — the engine auto-commits once reached (e.g. 3 for
   *  triangle/arc, 4 for double curve). Omit for 1/2-point or freeform tools. */
  readonly maxPoints?: number;
  /** Unbounded click-to-add tool (polyline/path/curve). Finishes on
   *  double-click or right-click. */
  readonly freeform?: boolean;
  /** Pointer-drag freehand tool. Records points on pointermove and commits
   *  on pointerup (TradingView Brush behavior). */
  readonly continuous?: boolean;

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
  move(
    origPoints: Point[],
    pointer: Point,
    dragStart: Point,
    context?: DrawingAdapterInteractionContext,
  ): Point[];
  /** Move a single anchor point to a new position. */
  moveAnchor(
    origPoints: Point[],
    index: number,
    pointer: Point,
    context?: DrawingAdapterInteractionContext,
  ): Point[];
  /** Return all interactive handle positions. */
  getAnchors(
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): Anchor[];
}

/** Runtime registration record: catalog metadata plus the geometry adapter. */
export interface DrawingToolDefinition<TProps = Record<string, unknown>>
  extends DrawingToolManifestEntry<TProps> {
  readonly adapter: DrawingAdapter;
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
    return {
      index: i,
      x,
      y,
      // `anchorIndex` is authoritative for 3+ point tools; p0 is the shared
      // visual label for additional vertices and must never be classified as
      // body movement.
      target: i === 0 ? "p1" : i === 1 ? "p2" : "p0",
    };
  });
}

// ---------------------------------------------------------------------------
// createAdapter — wraps a simple tool object into a full DrawingAdapter
// ---------------------------------------------------------------------------

export interface SimpleTool {
  readonly tool: DrawingTool;
  readonly minPoints: number;
  readonly maxPoints?: number;
  readonly freeform?: boolean;
  readonly continuous?: boolean;
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

const registry = new Map<DrawingTool, DrawingToolDefinition>();

/** Register a tool. Automatically wraps simple tools with defaults. */
export function registerTool(t: DrawingAdapter | SimpleTool): void {
  const adapter: DrawingAdapter = 'move' in t && 'moveAnchor' in t && 'getAnchors' in t
    ? t as DrawingAdapter
    : createAdapter(t as SimpleTool);
  if (registry.has(adapter.tool)) {
    throw new Error(`Duplicate drawing adapter registration: ${adapter.tool}`);
  }
  const metadata = getDrawingToolManifestEntry(adapter.tool);
  const expectedFreeform = metadata.creationMode === "click-freeform";
  const expectedContinuous = metadata.creationMode === "pointer-continuous";
  if (
    !metadata.persistent ||
    metadata.minPoints !== adapter.minPoints ||
    metadata.maxPoints !== adapter.maxPoints ||
    expectedFreeform !== !!adapter.freeform ||
    expectedContinuous !== !!adapter.continuous
  ) {
    throw new Error(`Drawing adapter creation contract disagrees with manifest: ${adapter.tool}`);
  }
  registry.set(adapter.tool, { ...metadata, adapter });
}
export function getTool(tool: DrawingTool): DrawingAdapter | undefined {
  return registry.get(tool)?.adapter;
}

export function allTools(): DrawingAdapter[] {
  return [...registry.values()].map((definition) => definition.adapter);
}

export function getToolDefinition(tool: DrawingTool): DrawingToolDefinition | undefined {
  return registry.get(tool);
}

export function allToolDefinitions(): DrawingToolDefinition[] {
  return [...registry.values()];
}

/** Development/test bootstrap gate. Call after adapters.ts has loaded. */
export function assertDrawingToolRegistryComplete(): void {
  const missing = DRAWING_TOOLS.filter((tool) => !registry.has(tool));
  if (missing.length > 0) {
    throw new Error(`Missing drawing adapter registrations: ${missing.join(", ")}`);
  }
}

// Backward-compat alias.
/** @deprecated Use DrawingAdapter instead. */
export type DrawingToolPlugin = SimpleTool;
