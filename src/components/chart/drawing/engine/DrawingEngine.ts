/**
 * DrawingEngine — thin orchestrator for the drawing subsystem.
 *
 * Responsibilities:
 *   - Re-exports the drawing interaction manager
 *   - Re-exports the canvas render loop factory
 *   - Re-exports the hit test function
 *   - Re-exports the chart interaction manager
 *
 * DrawingLayer (React component) imports from here only.
 * All internal modules (tools, hittest, renderer, interaction) are
 * implementation details that DrawingLayer never imports directly.
 */

// Drawing interaction (state machine, pointer capture, creation, drag, context menu)
export {
  useDrawingInteractionManager,
  type DrawingInteractionHandle,
  type DrawingInteractionManagerOpts,
  type Machine,
  type InteractionState,
  INITIAL_MACHINE,
} from "../interaction/DrawingInteractionManager";

// Render loop (rAF canvas rendering)
export {
  createRenderLoop,
  type RenderLoop,
  type RenderLoopDeps,
} from "../renderer/CanvasRenderer";

// Hit testing
export {
  hitTest,
  type HitResult,
  type HitTestProjector,
} from "../hittest/HitTestEngine";

// Tool registry (needed by older code paths)
export { getTool, defaultMovePoints } from "../tools/ToolRegistry";
