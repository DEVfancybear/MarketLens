/**
 * Tool adapters — all plugins imported for side-effect registration.
 *
 * Each tool lives in its own file under plugins/. Import order doesn't
 * matter — all calls to registerTool() happen at module load time.
 *
 * To add a new tool:
 *   1. Create plugins/MyNewTool.ts implementing DrawingToolPlugin
 *   2. Import it here
 *   Done — no other files change.
 */

// Milestone 3 — initial 4 tools
import "./plugins/HorizontalTool";
import "./plugins/VerticalTool";
import "./plugins/TrendLineTool";
import "./plugins/RectangleTool";

// Milestone 4 Phase 1 — linear tools
import "./plugins/RayTool";
import "./plugins/ExtendedLineTool";
import "./plugins/TrendAngleTool";
import "./plugins/InfoLineTool";
import "./plugins/HorizRayTool";
import "./plugins/CrossLineTool";
import "./plugins/ChannelTool";

// Milestone 4 Phase 2 — shape tools
import "./plugins/CircleTool";
import "./plugins/EllipseTool";
import "./plugins/RotatedRectTool";
import "./plugins/TriangleTool";
import "./plugins/PolylineTool";
import "./plugins/CurveTool";
import "./plugins/DoubleCurveTool";
import "./plugins/ArcTool";
import "./plugins/PathTool";

// Milestone 4 Phase 3 — financial tools
import "./plugins/FibTool"; // legacy (kept for backward compat)
import "./plugins/FibRetracementTool";
import "./plugins/FibExtensionTool";
import "./plugins/PositionTool";

// Milestone 4 Phase 4 — freehand + annotations
import "./plugins/BrushTool";
import "./plugins/ArrowTools";
import "./plugins/TextTool";
import "./plugins/EmojiTool";

// Phase 8 Wave A — bounded catalog expansion through reusable families
import "./plugins/RangeTools";
import "./plugins/ChannelVariantsTool";
import "./plugins/AnnotationTools";
import "./plugins/TimeProjectionTools";

// Phase 8 Wave B — shared level, fan, radial, Gann, and pitchfork geometry
import "./plugins/LevelFanTools";
import "./plugins/RadialLevelTools";
import "./plugins/GannGridTools";
import "./plugins/PitchforkTools";

// Phase 8 Wave C — shared labeled patterns and time cycles
import "./plugins/LabeledPatternTools";
import "./plugins/TimeCyclesTool";

// Phase 8 Wave D — immutable data snapshots, projections, and safe rich content
import "./plugins/DataDrivenTools";
import "./plugins/ProjectionRichTools";

import { assertDrawingToolRegistryComplete } from "./ToolRegistry";

if (process.env.NODE_ENV !== "production") {
  assertDrawingToolRegistryComplete();
}
