/**
 * ToolRegistry — plug-in interface and registry for drawing tools.
 *
 * Each drawing tool implements the DrawingToolPlugin interface. The renderer,
 * hit-tester, and interaction manager delegate to the plugin via the registry.
 * No giant switch statements. No tool-specific logic outside plugins.
 *
 * Adding a new tool: implement DrawingToolPlugin, call registerTool(), done.
 */
import type { Drawing, Point } from "@/types";
import type { DrawingTool } from "@/types";
import type { HitResult, HitTestProjector } from "../hittest/HitTestEngine";
import type { Projector } from "../drawingRenderer";

// Re-export geometry helpers.
export {
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
  distToRect,
  projectPoint,
  defaultMovePoints,
} from "../geometry/helpers";

// ---------------------------------------------------------------------------
// DrawingToolPlugin interface
// ---------------------------------------------------------------------------

export interface DrawingToolPlugin {
  /** The tool type this plugin handles. */
  readonly tool: DrawingTool;

  /** Minimum number of points needed to create this drawing. */
  readonly minPoints: number;

  /** Render the drawing onto a canvas context. */
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ): void;

  /** Compute all hit candidates for this drawing at the given pixel position. */
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[];

  /** Compute new point positions when a drawing is being dragged. */
  movePoints(
    origPoints: Point[],
    pointer: Point,
    dragTarget: "p1" | "p2" | "body",
    dragStart: Point,
  ): Point[];

  /** Compute the pixel bounding box of the drawing. */
  boundingBox(
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): { x: number; y: number; w: number; h: number } | null;

  /** (Future) Return interactive handle positions. */
  getHandles?: (
    d: Drawing,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ) => { x: number; y: number; target: "p1" | "p2" }[];

  /** (Future) Serialize drawing to storable format. */
  serialize?: (d: Drawing) => Record<string, unknown>;

  /** (Future) Deserialize stored data to Drawing. */
  deserialize?: (data: Record<string, unknown>) => Partial<Drawing>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<DrawingTool, DrawingToolPlugin>();

export function registerTool(t: DrawingToolPlugin): void {
  registry.set(t.tool, t);
}

export function getTool(tool: DrawingTool): DrawingToolPlugin | undefined {
  return registry.get(tool);
}

export function allTools(): DrawingToolPlugin[] {
  return [...registry.values()];
}
