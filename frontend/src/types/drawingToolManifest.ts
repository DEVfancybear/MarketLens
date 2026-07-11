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
  | "cursor" | "lines" | "shapes" | "fibonacci" | "positions" | "annotations";

export type DrawingSettingsProfile = "mode" | "line" | "shape" | "text" | "fib" | "position";
export type DrawingSettingsFeature =
  | "line" | "fill" | "text" | "middle-line" | "fib-levels" | "stats"
  | "coordinates" | "visibility" | "templates";

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
  readonly creationMode: DrawingCreationMode;
  readonly minPoints: number;
  readonly maxPoints?: number;
  readonly styleFamily: StyleFamily;
  readonly defaultProperties: Readonly<{ lineWidth: number } & Partial<TProps>>;
  readonly overlayExtension?: "text-editor";
  readonly selectionTextEditor?: "shape-center" | "line-midpoint";
  readonly settingsOverlay?: "position-dialog";
  readonly lifecycleExtension?: "position-resolution";
  readonly modeInteraction?: "selection" | "pass-through" | "erase";
  readonly settingsProfile: DrawingSettingsProfile;
  readonly settingsFeatures: readonly DrawingSettingsFeature[];
  readonly positionSide?: "long" | "short";
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
      ? ["stats", "line", "visibility", "templates"]
      : settingsProfile === "fib"
        ? ["line", "fill", "fib-levels", "coordinates", "visibility", "templates"]
        : settingsProfile === "text"
          ? ["text", "visibility", "templates"]
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

  tool("trendline", "Trendline", "lines", "trend", "two-point", 2, { hotkey: "Alt + T", section: "LINES", selectionTextEditor: "line-midpoint" }),
  tool("ray", "Ray", "lines", "ray", "two-point", 2),
  tool("infoLine", "Info line", "lines", "ruler", "two-point", 2),
  tool("extendedLine", "Extended line", "lines", "branch", "two-point", 2),
  tool("trendAngle", "Trend angle", "lines", "triangle", "two-point", 2),
  tool("horizontal", "Horizontal line", "lines", "horizontal", "one-point", 1, { hotkey: "Alt + H" }),
  tool("horizRay", "Horizontal ray", "lines", "horizontal", "one-point", 1, { hotkey: "Alt + J" }),
  tool("vertical", "Vertical line", "lines", "vertical", "one-point", 1, { hotkey: "Alt + V" }),
  tool("crossLine", "Crossline", "lines", "crosshair", "one-point", 1, { hotkey: "Alt + C" }),
  tool("channel", "Parallel channel", null, "trend", "fixed-multi-point", 2, { maxPoints: 3 }),

  tool("brush", "Brush", "shapes", "brush", "pointer-continuous", 2, { section: "BRUSHES" }),
  tool("highlighter", "Highlighter", "shapes", "highlighter", "pointer-continuous", 2),
  tool("arrowMarker", "Arrow marker", "shapes", "arrowUpRight", "two-point", 2, { section: "ARROWS" }),
  tool("arrow", "Arrow", "shapes", "arrowUpRight", "two-point", 2),
  tool("arrowMarkUp", "Arrow mark up", "shapes", "arrowUp", "one-point", 1),
  tool("arrowMarkDown", "Arrow mark down", "shapes", "arrowDown", "one-point", 1),
  tool("arrowMarkLeft", "Arrow mark left", "shapes", "arrowLeft", "one-point", 1),
  tool("arrowMarkRight", "Arrow mark right", "shapes", "arrowRight", "one-point", 1),
  tool("rectangle", "Rectangle", "shapes", "square", "two-point", 2, { hotkey: "Alt+Shift+R", section: "SHAPES", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "middle-line", "coordinates", "visibility", "templates"] }),
  tool("rotatedRect", "Rotated rectangle", "shapes", "square", "fixed-multi-point", 2, { maxPoints: 3, styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("path", "Path", "shapes", "path", "click-freeform", 2),
  tool("circle", "Circle", "shapes", "circle", "two-point", 2, { styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("ellipse", "Ellipse", "shapes", "circle", "two-point", 2, { styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("polyline", "Polyline", "shapes", "pen", "click-freeform", 2),
  tool("triangle", "Triangle", "shapes", "triangle", "fixed-multi-point", 3, { maxPoints: 3, styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("arc", "Arc", "shapes", "spline", "fixed-multi-point", 2, { maxPoints: 3 }),
  tool("curve", "Curve", "shapes", "spline", "click-freeform", 3),
  tool("doubleCurve", "Double curve", "shapes", "doubleCurve", "fixed-multi-point", 2, { maxPoints: 4 }),

  tool("fibRetracement", "Fib Retracement", "fibonacci", "fib", "two-point", 2, { settingsProfile: "fib" }),
  tool("fibExtension", "Trend-Based Fib Extension", "fibonacci", "fibExtension", "fixed-multi-point", 2, { maxPoints: 3, settingsProfile: "fib" }),
  tool("fib", "Fib (legacy)", "fibonacci", "fib", "two-point", 2, { preferredForCreation: false, settingsProfile: "fib" }),
  tool("long", "Long position", "positions", "long", "one-point", 1, { settingsOverlay: "position-dialog", lifecycleExtension: "position-resolution", settingsProfile: "position", positionSide: "long" }),
  tool("short", "Short position", "positions", "short", "one-point", 1, { settingsOverlay: "position-dialog", lifecycleExtension: "position-resolution", settingsProfile: "position", positionSide: "short" }),
  tool("text", "Text", "annotations", "text", "one-point", 1, { styleFamily: "text", overlayExtension: "text-editor" }),
  tool("emoji", "Emoji", "annotations", "emoji", "one-point", 1, { styleFamily: "text" }),
] satisfies readonly DrawingToolManifestEntry[]);

export const DRAWING_TOOL_GROUPS = Object.freeze([
  { id: "cursor", label: "Cursor", iconKey: "cursor", defaultTool: "cursor" },
  { id: "lines", label: "Trend line", iconKey: "trend", defaultTool: "trendline" },
  { id: "shapes", label: "Rectangle", iconKey: "square", defaultTool: "rectangle" },
  { id: "fibonacci", label: "Fib Retracement", iconKey: "fib", defaultTool: "fibRetracement" },
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
