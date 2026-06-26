/**
 * DrawingEngine — thin orchestrator for the drawing subsystem.
 *
 * DrawingLayer (React component) imports from here only.
 * All internal modules are implementation details.
 */
export {
  useDrawingInteractionManager,
  type DrawingInteractionHandle,
  type DrawingInteractionManagerOpts,
  type Machine,
  type InteractionState,
  INITIAL_MACHINE,
} from "../interaction/DrawingInteractionManager";

export {
  createRenderLoop,
  type RenderLoop,
  type RenderLoopDeps,
} from "../renderer/CanvasRenderer";

export {
  hitTest,
  type HitResult,
  type HitTestProjector,
} from "../hittest/HitTestEngine";

export {
  getTool,
  defaultMove,
  defaultMoveAnchor,
  defaultGetAnchors,
  createAdapter,
  registerTool,
  type DrawingAdapter,
  type SimpleTool,
  type Anchor,
} from "../tools/ToolRegistry";

// Backward compat.
export { getTool as getAdapter } from "../tools/ToolRegistry";
export { defaultMovePoints } from "../tools/ToolRegistry";
