/**
 * DrawingEngine — thin orchestrator for the drawing subsystem.
 *
 * Responsibilities:
 *   - Re-exports the interaction manager (usePointerController)
 *   - Re-exports the canvas render loop factory (createRenderLoop)
 *   - Re-exports the hit test function
 *
 * DrawingLayer (React component) imports from here only.
 * All internal modules (tools, hittest, renderer, interaction) are
 * implementation details that DrawingLayer never imports directly.
 */

// Interaction
export {
  usePointerController,
  type PointerController,
  type PointerControllerOpts,
  type Machine,
  type InteractionState,
} from "../interaction/InteractionManager";

// Render loop
export {
  createRenderLoop,
  type RenderLoop,
  type RenderLoopDeps,
} from "../renderer/CanvasRenderer";

// Hit testing
export { hitTest, type HitResult, type HitTestProjector } from "../hittest/HitTestEngine";

// Tool registry (needed by older code paths)
export { getAdapter, defaultMovePoints } from "../tools/ToolRegistry";
