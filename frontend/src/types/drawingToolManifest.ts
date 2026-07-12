import type { StyleFamily } from "./drawing";

/** Stable ids and their metadata intentionally live in the same module. */
export const ALL_DRAWING_TOOL_IDS = [
  "cursor", "crosshair", "eraser", "measure",
  "trendline", "ray", "extendedLine", "trendAngle", "horizontal",
  "horizRay", "vertical", "crossLine", "infoLine", "channel",
  "rectangle", "rotatedRect", "circle", "ellipse", "triangle",
  "polyline", "curve", "doubleCurve", "arc", "path", "fib",
  "fibRetracement", "fibExtension", "text", "emoji", "long", "short",
  "brush", "highlighter", "arrowMarker", "arrow", "arrowMarkUp",
  "arrowMarkDown", "arrowMarkLeft", "arrowMarkRight",
  "priceRange", "dateRange", "datePriceRange",
  "flatTopBottom", "disjointChannel",
  "note", "callout", "comment", "priceLabel", "signpost", "flag",
  "cyclicLines", "fibTimeZone",
  "fibChannel", "fibSpeedFan", "fibSpeedArcs", "fibCircles", "fibWedge",
  "trendFibTime", "pitchfan", "gannFan", "gannSquare", "gannBox",
  "pitchfork", "insidePitchfork", "schiffPitchfork", "modifiedSchiffPitchfork",
  "abcdPattern", "xabcdPattern", "trianglePattern", "threeDrivesPattern",
  "headShouldersPattern", "elliottImpulse", "elliottTriangle",
  "elliottTripleCombo", "elliottCorrection", "elliottDoubleCombo", "timeCycles",
] as const;

export type DrawingTool = (typeof ALL_DRAWING_TOOL_IDS)[number];

export type DrawingCreationMode =
  | "mode"
  | "one-point"
  | "two-point"
  | "fixed-multi-point"
  | "click-freeform"
  | "pointer-continuous";

export type DrawingIconKey =
  | "cursor" | "target" | "eraser" | "ruler" | "trend" | "ray"
  | "branch" | "triangle" | "horizontal" | "vertical" | "crosshair"
  | "square" | "circle" | "pen" | "spline" | "path" | "doubleCurve"
  | "fib" | "fibExtension" | "long" | "short" | "brush"
  | "highlighter" | "arrowUpRight" | "arrowUp" | "arrowDown"
  | "arrowLeft" | "arrowRight" | "text" | "emoji";

export type DrawingToolGroupId =
  | "cursor" | "lines" | "shapes" | "fibonacci" | "patterns"
  | "measurements" | "positions" | "annotations";

export type DrawingSettingsProfile = "mode" | "line" | "shape" | "text" | "fib" | "position";
export type DrawingSettingsFeature =
  | "line" | "fill" | "text" | "middle-line" | "fib-levels" | "stats"
  | "trendline-parity" | "channel-levels"
  | "coordinates" | "visibility" | "templates";
export type DrawingAlertProjection =
  | "point-price"
  | "range-boundaries"
  | "fib-retracement-levels"
  | "fib-extension-levels"
  | "position-levels";

export interface DrawingToolManifestEntry<TProps = Record<string, unknown>> {
  readonly id: DrawingTool;
  readonly schemaVersion: number;
  readonly displayName: string;
  readonly group: DrawingToolGroupId | null;
  readonly iconKey: DrawingIconKey;
  readonly hotkey?: string;
  readonly section?: string;
  readonly persistent: boolean;
  readonly favoriteEligible: boolean;
  readonly preferredForCreation: boolean;
  readonly rollout?: "phase8-wave-a" | "phase8-wave-b" | "phase8-wave-c";
  readonly creationMode: DrawingCreationMode;
  readonly minPoints: number;
  readonly maxPoints?: number;
  readonly styleFamily: StyleFamily;
  readonly defaultProperties: Readonly<{ lineWidth: number } & Partial<TProps>>;
  readonly overlayExtension?: "text-editor";
  readonly selectionTextEditor?: "shape-center" | "line-midpoint";
  readonly settingsOverlay?: "position-dialog";
  readonly lifecycleExtension?: "position-resolution";
  readonly magnetEligible: boolean;
  readonly angleConstraint?: "45-degree";
  readonly pointSimplificationTolerance?: number;
  readonly coordinateLabels?: readonly string[];
  readonly modeInteraction?: "selection" | "pass-through" | "erase";
  readonly settingsProfile: DrawingSettingsProfile;
  readonly settingsFeatures: readonly DrawingSettingsFeature[];
  readonly positionSide?: "long" | "short";
  /** Fixed-price targets that can be snapshotted into the current alert runtime. */
  readonly alertProjection?: DrawingAlertProjection;
}

export interface DrawingToolGroupDefinition {
  readonly id: DrawingToolGroupId;
  readonly label: string;
  readonly iconKey: DrawingIconKey;
  readonly defaultTool: DrawingTool;
}

const COMMON_DEFAULTS = Object.freeze({ lineWidth: 1.5 });

function tool(
  id: DrawingTool,
  displayName: string,
  group: DrawingToolGroupId | null,
  iconKey: DrawingIconKey,
  creationMode: DrawingCreationMode,
  minPoints: number,
  options: Partial<Omit<DrawingToolManifestEntry, "id" | "displayName" | "group" | "iconKey" | "creationMode" | "minPoints">> = {},
): DrawingToolManifestEntry {
  const persistent = creationMode !== "mode";
  const styleFamily = options.styleFamily ?? "line";
  const settingsProfile = options.settingsProfile ?? (
    !persistent ? "mode" : styleFamily === "shape" ? "shape" : styleFamily === "text" ? "text" : "line"
  );
  const settingsFeatures = options.settingsFeatures ?? (
    settingsProfile === "mode" ? [] : settingsProfile === "position"
      ? ["stats", "line", "coordinates", "visibility", "templates"]
      : settingsProfile === "fib"
        ? ["line", "fill", "fib-levels", "coordinates", "visibility", "templates"]
        : settingsProfile === "text"
          ? ["text", "coordinates", "visibility", "templates"]
          : settingsProfile === "shape"
            ? ["line", "fill", "text", "coordinates", "visibility", "templates"]
            : ["line", ...(options.selectionTextEditor ? ["text" as const] : []), "coordinates", "visibility", "templates"]
  );
  return Object.freeze({
    id,
    schemaVersion: 1,
    displayName,
    group,
    iconKey,
    creationMode,
    minPoints,
    persistent,
    favoriteEligible: persistent,
    preferredForCreation: persistent,
    magnetEligible: persistent && creationMode !== "pointer-continuous",
    styleFamily,
    settingsProfile,
    settingsFeatures,
    defaultProperties: COMMON_DEFAULTS,
    ...options,
  });
}

/** Single metadata catalog. Ordering is toolbar ordering within each group. */
export const DRAWING_TOOL_MANIFEST = Object.freeze([
  tool("cursor", "Cursor", "cursor", "cursor", "mode", 0, { favoriteEligible: true, modeInteraction: "selection" }),
  tool("crosshair", "Crosshair", "cursor", "target", "mode", 0, { favoriteEligible: true, modeInteraction: "pass-through" }),
  tool("eraser", "Eraser", "cursor", "eraser", "mode", 0, { favoriteEligible: true, modeInteraction: "erase" }),
  tool("measure", "Measure", null, "ruler", "mode", 0, { favoriteEligible: false, modeInteraction: "pass-through" }),

  tool("trendline", "Trendline", "lines", "trend", "two-point", 2, { hotkey: "Alt + T", section: "LINES", selectionTextEditor: "line-midpoint", angleConstraint: "45-degree", settingsFeatures: ["line", "text", "trendline-parity", "coordinates", "visibility", "templates"] }),
  tool("ray", "Ray", "lines", "ray", "two-point", 2),
  tool("infoLine", "Info line", "lines", "ruler", "two-point", 2),
  tool("extendedLine", "Extended line", "lines", "branch", "two-point", 2),
  tool("trendAngle", "Trend angle", "lines", "triangle", "two-point", 2),
  tool("horizontal", "Horizontal line", "lines", "horizontal", "one-point", 1, { hotkey: "Alt + H", alertProjection: "point-price" }),
  tool("horizRay", "Horizontal ray", "lines", "horizontal", "one-point", 1, { hotkey: "Alt + J", alertProjection: "point-price" }),
  tool("vertical", "Vertical line", "lines", "vertical", "one-point", 1, { hotkey: "Alt + V" }),
  tool("crossLine", "Crossline", "lines", "crosshair", "one-point", 1, { hotkey: "Alt + C", alertProjection: "point-price" }),
  tool("channel", "Parallel channel", null, "trend", "fixed-multi-point", 2, { maxPoints: 3, selectionTextEditor: "line-midpoint", settingsFeatures: ["line", "fill", "text", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("flatTopBottom", "Flat top/bottom", "lines", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-a", selectionTextEditor: "line-midpoint", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("disjointChannel", "Disjoint channel", "lines", "trend", "fixed-multi-point", 4, { maxPoints: 4, rollout: "phase8-wave-a", selectionTextEditor: "line-midpoint", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),

  tool("brush", "Brush", "shapes", "brush", "pointer-continuous", 2, { section: "BRUSHES", pointSimplificationTolerance: 0.75 }),
  tool("highlighter", "Highlighter", "shapes", "highlighter", "pointer-continuous", 2, { pointSimplificationTolerance: 0.75 }),
  tool("arrowMarker", "Arrow marker", "shapes", "arrowUpRight", "two-point", 2, { section: "ARROWS" }),
  tool("arrow", "Arrow", "shapes", "arrowUpRight", "two-point", 2),
  tool("arrowMarkUp", "Arrow mark up", "shapes", "arrowUp", "one-point", 1),
  tool("arrowMarkDown", "Arrow mark down", "shapes", "arrowDown", "one-point", 1),
  tool("arrowMarkLeft", "Arrow mark left", "shapes", "arrowLeft", "one-point", 1),
  tool("arrowMarkRight", "Arrow mark right", "shapes", "arrowRight", "one-point", 1),
  tool("rectangle", "Rectangle", "shapes", "square", "two-point", 2, { hotkey: "Alt+Shift+R", section: "SHAPES", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "middle-line", "coordinates", "visibility", "templates"], alertProjection: "range-boundaries" }),
  tool("rotatedRect", "Rotated rectangle", "shapes", "square", "fixed-multi-point", 2, { maxPoints: 3, styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("path", "Path", "shapes", "path", "click-freeform", 2),
  tool("circle", "Circle", "shapes", "circle", "two-point", 2, { styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("ellipse", "Ellipse", "shapes", "circle", "two-point", 2, { styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("polyline", "Polyline", "shapes", "pen", "click-freeform", 2),
  tool("triangle", "Triangle", "shapes", "triangle", "fixed-multi-point", 3, { maxPoints: 3, styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("arc", "Arc", "shapes", "spline", "fixed-multi-point", 2, { maxPoints: 3 }),
  tool("curve", "Curve", "shapes", "spline", "click-freeform", 3),
  tool("doubleCurve", "Double curve", "shapes", "doubleCurve", "fixed-multi-point", 2, { maxPoints: 4 }),

  tool("fibRetracement", "Fib Retracement", "fibonacci", "fib", "two-point", 2, { settingsProfile: "fib", alertProjection: "fib-retracement-levels" }),
  tool("fibExtension", "Trend-Based Fib Extension", "fibonacci", "fibExtension", "fixed-multi-point", 2, { maxPoints: 3, settingsProfile: "fib", alertProjection: "fib-extension-levels" }),
  tool("fibTimeZone", "Fib Time Zone", "fibonacci", "fib", "two-point", 2, { rollout: "phase8-wave-a" }),
  tool("fibChannel", "Fib Channel", "fibonacci", "fib", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("fibSpeedFan", "Fib Speed Resistance Fan", "fibonacci", "fib", "two-point", 2, { rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("fibSpeedArcs", "Fib Speed Resistance Arcs", "fibonacci", "fib", "two-point", 2, { rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("fibCircles", "Fib Circles", "fibonacci", "circle", "two-point", 2, { rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("fibWedge", "Fib Wedge", "fibonacci", "fib", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("trendFibTime", "Trend-Based Fib Time", "fibonacci", "fibExtension", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("pitchfan", "Pitchfan", "fibonacci", "fib", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("gannFan", "Gann Fan", "fibonacci", "fib", "two-point", 2, { rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "coordinates", "visibility", "templates"] }),
  tool("gannSquare", "Gann Square", "fibonacci", "square", "two-point", 2, { rollout: "phase8-wave-b", styleFamily: "shape", settingsFeatures: ["line", "fill", "coordinates", "visibility", "templates"] }),
  tool("gannBox", "Gann Box", "fibonacci", "square", "two-point", 2, { rollout: "phase8-wave-b", styleFamily: "shape", settingsFeatures: ["line", "fill", "coordinates", "visibility", "templates"] }),
  tool("pitchfork", "Pitchfork", "fibonacci", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("insidePitchfork", "Inside Pitchfork", "fibonacci", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("schiffPitchfork", "Schiff Pitchfork", "fibonacci", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("modifiedSchiffPitchfork", "Modified Schiff Pitchfork", "fibonacci", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("fib", "Fib (legacy)", "fibonacci", "fib", "two-point", 2, { preferredForCreation: false, settingsProfile: "fib", alertProjection: "fib-retracement-levels" }),
  tool("cyclicLines", "Cyclic lines", "patterns", "vertical", "two-point", 2, { rollout: "phase8-wave-a" }),
  tool("abcdPattern", "ABCD Pattern", "patterns", "path", "fixed-multi-point", 4, { maxPoints: 4, rollout: "phase8-wave-c", styleFamily: "shape", coordinateLabels: ["A", "B", "C", "D"], settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("xabcdPattern", "XABCD Pattern", "patterns", "path", "fixed-multi-point", 5, { maxPoints: 5, rollout: "phase8-wave-c", styleFamily: "shape", coordinateLabels: ["X", "A", "B", "C", "D"], settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("trianglePattern", "Triangle Pattern", "patterns", "triangle", "fixed-multi-point", 4, { maxPoints: 4, rollout: "phase8-wave-c", styleFamily: "shape", coordinateLabels: ["1", "2", "3", "4"], settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("threeDrivesPattern", "Three Drives Pattern", "patterns", "path", "fixed-multi-point", 7, { maxPoints: 7, rollout: "phase8-wave-c", styleFamily: "shape", coordinateLabels: ["X", "1", "A", "2", "B", "3", "C"], settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("headShouldersPattern", "Head and Shoulders", "patterns", "branch", "fixed-multi-point", 7, { maxPoints: 7, rollout: "phase8-wave-c", styleFamily: "shape", coordinateLabels: ["Start", "Left shoulder", "Neck 1", "Head", "Neck 2", "Right shoulder", "End"], settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("elliottImpulse", "Elliott Impulse Wave", "patterns", "path", "fixed-multi-point", 6, { maxPoints: 6, rollout: "phase8-wave-c", coordinateLabels: ["Start", "1", "2", "3", "4", "5"] }),
  tool("elliottTriangle", "Elliott Triangle Wave", "patterns", "triangle", "fixed-multi-point", 6, { maxPoints: 6, rollout: "phase8-wave-c", coordinateLabels: ["Start", "A", "B", "C", "D", "E"] }),
  tool("elliottTripleCombo", "Elliott Triple Combo Wave", "patterns", "path", "fixed-multi-point", 6, { maxPoints: 6, rollout: "phase8-wave-c", coordinateLabels: ["Start", "W", "X", "Y", "X", "Z"] }),
  tool("elliottCorrection", "Elliott Correction Wave", "patterns", "path", "fixed-multi-point", 4, { maxPoints: 4, rollout: "phase8-wave-c", coordinateLabels: ["Start", "A", "B", "C"] }),
  tool("elliottDoubleCombo", "Elliott Double Combo Wave", "patterns", "path", "fixed-multi-point", 4, { maxPoints: 4, rollout: "phase8-wave-c", coordinateLabels: ["Start", "W", "X", "Y"] }),
  tool("timeCycles", "Time Cycles", "patterns", "circle", "two-point", 2, { rollout: "phase8-wave-c" }),
  tool("priceRange", "Price range", "measurements", "ruler", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("dateRange", "Date range", "measurements", "ruler", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("datePriceRange", "Date and price range", "measurements", "ruler", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("long", "Long position", "positions", "long", "one-point", 1, { settingsOverlay: "position-dialog", lifecycleExtension: "position-resolution", settingsProfile: "position", positionSide: "long", coordinateLabels: ["Entry", "Target", "Stop"], alertProjection: "position-levels" }),
  tool("short", "Short position", "positions", "short", "one-point", 1, { settingsOverlay: "position-dialog", lifecycleExtension: "position-resolution", settingsProfile: "position", positionSide: "short", coordinateLabels: ["Entry", "Target", "Stop"], alertProjection: "position-levels" }),
  tool("text", "Text", "annotations", "text", "one-point", 1, { styleFamily: "text", overlayExtension: "text-editor" }),
  tool("emoji", "Emoji", "annotations", "emoji", "one-point", 1, { styleFamily: "text" }),
  tool("note", "Note", "annotations", "text", "one-point", 1, { rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("callout", "Callout", "annotations", "text", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("comment", "Comment", "annotations", "text", "one-point", 1, { rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("priceLabel", "Price label", "annotations", "text", "one-point", 1, { rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor", alertProjection: "point-price" }),
  tool("signpost", "Signpost", "annotations", "text", "one-point", 1, { rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("flag", "Flag mark", "annotations", "text", "one-point", 1, { rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
] satisfies readonly DrawingToolManifestEntry[]);

export const DRAWING_TOOL_GROUPS = Object.freeze([
  { id: "cursor", label: "Cursor", iconKey: "cursor", defaultTool: "cursor" },
  { id: "lines", label: "Trend line", iconKey: "trend", defaultTool: "trendline" },
  { id: "shapes", label: "Rectangle", iconKey: "square", defaultTool: "rectangle" },
  { id: "fibonacci", label: "Fib Retracement", iconKey: "fib", defaultTool: "fibRetracement" },
  { id: "patterns", label: "Patterns", iconKey: "vertical", defaultTool: "cyclicLines" },
  { id: "measurements", label: "Ranges", iconKey: "ruler", defaultTool: "datePriceRange" },
  { id: "positions", label: "Long position", iconKey: "long", defaultTool: "long" },
  { id: "annotations", label: "Text", iconKey: "text", defaultTool: "text" },
] satisfies readonly DrawingToolGroupDefinition[]);

const manifestById = new Map<DrawingTool, DrawingToolManifestEntry>();
for (const definition of DRAWING_TOOL_MANIFEST) {
  if (manifestById.has(definition.id)) throw new Error(`Duplicate drawing tool id: ${definition.id}`);
  manifestById.set(definition.id, definition);
}
if (manifestById.size !== ALL_DRAWING_TOOL_IDS.length || ALL_DRAWING_TOOL_IDS.some((id) => !manifestById.has(id))) {
  throw new Error("Drawing tool manifest is incomplete");
}

export function getDrawingToolManifestEntry(toolId: DrawingTool): DrawingToolManifestEntry {
  const definition = manifestById.get(toolId);
  if (!definition) throw new Error(`Unknown drawing tool: ${toolId}`);
  return definition;
}

/** Creation-only kill switch. Adapters/codecs remain active for saved drawings. */
export function isDrawingToolCreationEnabled(
  toolId: DrawingTool,
  phase8WaveAEnabled = process.env.NEXT_PUBLIC_DRAWING_PHASE8_WAVE_A !== "false",
  phase8WaveBEnabled = process.env.NEXT_PUBLIC_DRAWING_PHASE8_WAVE_B !== "false",
  phase8WaveCEnabled = process.env.NEXT_PUBLIC_DRAWING_PHASE8_WAVE_C !== "false",
): boolean {
  const definition = getDrawingToolManifestEntry(toolId);
  if (definition.rollout === "phase8-wave-a") return phase8WaveAEnabled;
  if (definition.rollout === "phase8-wave-b") return phase8WaveBEnabled;
  if (definition.rollout === "phase8-wave-c") return phase8WaveCEnabled;
  return true;
}

export const DRAWING_TOOLS: DrawingTool[] = DRAWING_TOOL_MANIFEST.filter((entry) => entry.persistent).map((entry) => entry.id);
export const MODE_TOOLS: DrawingTool[] = DRAWING_TOOL_MANIFEST.filter((entry) => !entry.persistent).map((entry) => entry.id);
export const SHAPE_TOOLS: DrawingTool[] = DRAWING_TOOL_MANIFEST.filter((entry) => entry.styleFamily === "shape").map((entry) => entry.id);

export function styleFamily(toolId: DrawingTool): StyleFamily {
  return getDrawingToolManifestEntry(toolId).styleFamily;
}

export function normalizeFavoriteDrawingTools(tools: readonly string[]): DrawingTool[] {
  const seen = new Set<string>();
  const result: DrawingTool[] = [];
  for (const id of tools) {
    const definition = manifestById.get(id as DrawingTool);
    if (!definition?.favoriteEligible || seen.has(id)) continue;
    seen.add(id);
    result.push(definition.id);
  }
  return result;
}
