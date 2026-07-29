import type { StyleFamily } from "./drawing";
import {
  cloneGannConfig,
  DEFAULT_GANN_BOX_CONFIG,
  DEFAULT_GANN_FAN_CONFIG,
  DEFAULT_GANN_SQUARE_CONFIG,
  type GannFamily,
} from "./gann";
import { DEFAULT_REGRESSION_TREND_CONFIG } from "./regressionTrend";
import { DEFAULT_VOLUME_PROFILE_CONFIG } from "./volumeProfile";

/** Stable ids and their metadata intentionally live in the same module. */
export const ALL_DRAWING_TOOL_IDS = [
  "cursor", "crosshair", "dotCursor", "demonstrationCursor", "magicCursor",
  "eraser", "measure",
  "trendline", "ray", "extendedLine", "trendAngle", "horizontal",
  "horizRay", "vertical", "crossLine", "infoLine", "channel",
  "rectangle", "rotatedRect", "circle", "ellipse", "triangle",
  "polyline", "curve", "doubleCurve", "arc", "path", "fib",
  "fibRetracement", "fibExtension", "text", "emoji", "long", "short",
  "brush", "highlighter", "arrowMarker", "arrow", "arrowMarkUp",
  "arrowMarkDown", "arrowMarkLeft", "arrowMarkRight",
  "priceRange", "dateRange", "datePriceRange",
  "flatTopBottom", "disjointChannel",
  "note", "priceNote", "pin", "callout", "comment", "priceLabel", "signpost", "flag",
  "cyclicLines", "fibTimeZone",
  "fibChannel", "fibSpeedFan", "fibSpeedArcs", "fibCircles", "fibSpiral", "fibWedge",
  "trendFibTime", "pitchfan", "gannFan", "gannSquare", "gannBox",
  "pitchfork", "insidePitchfork", "schiffPitchfork", "modifiedSchiffPitchfork",
  "abcdPattern", "xabcdPattern", "trianglePattern", "threeDrivesPattern",
  "headShouldersPattern", "elliottImpulse", "elliottTriangle",
  "elliottTripleCombo", "elliottCorrection", "elliottDoubleCombo", "timeCycles",
  "anchoredVWAP", "fixedVolumeProfile", "anchoredVolumeProfile", "regressionTrend",
  "barsPattern", "ghostFeed", "forecast", "sector", "table", "image", "socialEmbed",
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
  | "arrowLeft" | "arrowRight" | "text" | "emoji" | "dot"
  | "presentation" | "magic" | "pin" | "spiral";

export type DrawingToolGroupId =
  | "cursor" | "lines" | "shapes" | "fibonacci" | "patterns"
  | "measurements" | "positions" | "annotations" | "icons";

export type DrawingSettingsProfile = "mode" | "line" | "shape" | "text" | "fib" | "position";
export type DrawingSettingsFeature =
  | "line" | "fill" | "text" | "middle-line" | "fib-levels" | "stats"
  | "trendline-parity" | "price-label" | "time-label" | "channel-levels" | "gann"
  | "regression-inputs" | "regression-style"
  | "volume-profile-inputs" | "volume-profile-style"
  | "coordinates" | "visibility" | "templates";
export type DrawingAlertProjection =
  | "point-price"
  | "range-boundaries"
  | "fib-retracement-levels"
  | "fib-extension-levels"
  | "position-levels";
export type DrawingDynamicAlertProjection =
  | "dynamic-line"
  | "dynamic-channel"
  | "dynamic-fib-channel";

/** A normalized keyboard chord owned by the tool catalog. */
export interface DrawingToolShortcut {
  readonly key: string;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}

export interface DrawingToolManifestEntry<TProps = Record<string, unknown>> {
  readonly id: DrawingTool;
  readonly schemaVersion: number;
  readonly displayName: string;
  /** Official TradingView behavior references that must be reviewed before changing the tool. */
  readonly officialDocs: readonly string[];
  readonly group: DrawingToolGroupId | null;
  readonly iconKey: DrawingIconKey;
  readonly shortcuts: readonly DrawingToolShortcut[];
  readonly section?: string;
  readonly persistent: boolean;
  readonly favoriteEligible: boolean;
  readonly preferredForCreation: boolean;
  readonly rollout?: "phase8-wave-a" | "phase8-wave-b" | "phase8-wave-c" | "phase8-wave-d";
  readonly creationMode: DrawingCreationMode;
  readonly minPoints: number;
  readonly maxPoints?: number;
  readonly styleFamily: StyleFamily;
  readonly defaultProperties: Readonly<{ lineWidth: number } & Partial<TProps>>;
  readonly overlayExtension?: "text-editor";
  /**
   * Location of the inline text target exposed on the chart.  Axis targets are
   * deliberately separate from the generic line midpoint: TradingView lets a
   * user click the price/time badge itself to enter text, while clicking the
   * line body continues to select the drawing.
   */
  readonly selectionTextEditor?:
    | "shape-center"
    | "line-midpoint"
    | "axis-price"
    | "axis-time";
  readonly settingsOverlay?: "position-dialog";
  readonly lifecycleExtension?: "position-resolution";
  readonly dataSnapshot?: "anchor-to-latest" | "between-anchors";
  /** Optional market-detail capture owned by data-driven drawing families. */
  readonly dataSnapshotDetail?: "volume-profile";
  readonly contentKind?: "table" | "image" | "social";
  readonly magnetEligible: boolean;
  readonly angleConstraint?: "45-degree";
  /** Shift/scale constraint shared by the Gann family. */
  readonly gannScaleConstraint?: "price-bar-ratio";
  readonly gannFamily?: GannFamily;
  readonly pointSimplificationTolerance?: number;
  /** A freeform shape can finish by clicking back on its first visual anchor. */
  readonly freeformCloseOnFirstPoint?: boolean;
  readonly coordinateLabels?: readonly string[];
  /** Whether the Coordinates tab exposes price alongside time/bar values. */
  readonly coordinatePriceEditable: boolean;
  readonly modeInteraction?: "selection" | "pass-through" | "erase" | "demonstration";
  readonly settingsProfile: DrawingSettingsProfile;
  readonly settingsFeatures: readonly DrawingSettingsFeature[];
  readonly positionSide?: "long" | "short";
  /** Some projected tools cannot be bounded reliably by the current time scale. */
  readonly viewportCulling: "spatial" | "always-render";
  /** Fixed-price targets that can be snapshotted into the current alert runtime. */
  readonly alertProjection?: DrawingAlertProjection;
  /** Frozen geometry evaluated at every market timestamp. */
  readonly dynamicAlertProjection?: DrawingDynamicAlertProjection;
}

export interface DrawingToolGroupDefinition {
  readonly id: DrawingToolGroupId;
  readonly label: string;
  readonly iconKey: DrawingIconKey;
  readonly defaultTool: DrawingTool;
}

const COMMON_DEFAULTS = Object.freeze({ lineWidth: 1.5 });
const DRAWING_CATALOG_DOC = "https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/";

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
    officialDocs: [DRAWING_CATALOG_DOC],
    group,
    iconKey,
    creationMode,
    minPoints,
    persistent,
    favoriteEligible: persistent,
    preferredForCreation: persistent,
    magnetEligible: persistent && creationMode !== "pointer-continuous",
    shortcuts: [],
    viewportCulling: "spatial",
    coordinatePriceEditable: true,
    styleFamily,
    settingsProfile,
    settingsFeatures,
    defaultProperties: COMMON_DEFAULTS,
    ...options,
  });
}

/** Single metadata catalog. Ordering is toolbar ordering within each group. */
export const DRAWING_TOOL_MANIFEST = Object.freeze([
  tool("crosshair", "Cross", "cursor", "crosshair", "mode", 0, { favoriteEligible: true, modeInteraction: "selection", shortcuts: [{ key: "1", shiftKey: true }] }),
  tool("dotCursor", "Dot", "cursor", "dot", "mode", 0, { favoriteEligible: true, modeInteraction: "selection" }),
  tool("cursor", "Arrow", "cursor", "cursor", "mode", 0, { favoriteEligible: true, modeInteraction: "selection" }),
  tool("demonstrationCursor", "Demonstration", "cursor", "presentation", "mode", 0, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000747626-how-to-draw-temporarily-on-the-chart-demonstration-cursor/"],
    favoriteEligible: true,
    modeInteraction: "demonstration",
  }),
  tool("magicCursor", "Magic", "cursor", "magic", "mode", 0, { favoriteEligible: true, modeInteraction: "selection" }),
  tool("eraser", "Eraser", "cursor", "eraser", "mode", 0, { favoriteEligible: true, modeInteraction: "erase" }),
  tool("measure", "Measure", null, "ruler", "mode", 0, { favoriteEligible: false, modeInteraction: "pass-through" }),

  tool("trendline", "Trendline", "lines", "trend", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518095-trendline-drawing-tool/"], shortcuts: [{ key: "2", shiftKey: true }, { key: "t", altKey: true }], section: "LINES", selectionTextEditor: "line-midpoint", angleConstraint: "45-degree", dynamicAlertProjection: "dynamic-line", settingsFeatures: ["line", "text", "trendline-parity", "coordinates", "visibility", "templates"] }),
  tool("ray", "Ray", "lines", "ray", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518113-ray-drawing-tool/"], selectionTextEditor: "line-midpoint", dynamicAlertProjection: "dynamic-line", settingsFeatures: ["line", "text", "trendline-parity", "coordinates", "visibility", "templates"] }),
  tool("infoLine", "Info line", "lines", "ruler", "two-point", 2, { dynamicAlertProjection: "dynamic-line" }),
  tool("extendedLine", "Extended line", "lines", "branch", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518131-extended-line-drawing-tool/"], selectionTextEditor: "line-midpoint", dynamicAlertProjection: "dynamic-line", settingsFeatures: ["line", "text", "trendline-parity", "coordinates", "visibility", "templates"] }),
  tool("trendAngle", "Trend angle", "lines", "triangle", "two-point", 2, { dynamicAlertProjection: "dynamic-line" }),
  tool("horizontal", "Horizontal line", "lines", "horizontal", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518124-horizontal-line-drawing-tool/"], shortcuts: [{ key: "3", shiftKey: true }, { key: "h", altKey: true }], defaultProperties: { lineWidth: 1.5, showPriceLabels: true }, selectionTextEditor: "axis-price", settingsFeatures: ["line", "text", "price-label", "coordinates", "visibility", "templates"], alertProjection: "point-price" }),
  tool("horizRay", "Horizontal ray", "lines", "horizontal", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518121-horizontal-ray-drawing-tool/"], shortcuts: [{ key: "j", altKey: true }], defaultProperties: { lineWidth: 1.5, showPriceLabels: true }, settingsFeatures: ["line", "text", "price-label", "coordinates", "visibility", "templates"], alertProjection: "point-price" }),
  tool("vertical", "Vertical line", "lines", "vertical", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518093-vertical-line-drawing-tool/"], shortcuts: [{ key: "v", altKey: true }], defaultProperties: { lineWidth: 1.5, showTimeLabel: true }, selectionTextEditor: "axis-time", settingsFeatures: ["line", "text", "time-label", "coordinates", "visibility", "templates"] }),
  tool("crossLine", "Crossline", "lines", "crosshair", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000477747-crossline-drawing-tool/"], shortcuts: [{ key: "c", altKey: true }], defaultProperties: { lineWidth: 1.5, showPriceLabels: true, showTimeLabel: true }, settingsFeatures: ["line", "price-label", "time-label", "coordinates", "visibility", "templates"], alertProjection: "point-price" }),
  tool("channel", "Parallel channel", "lines", "trend", "fixed-multi-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518117-parallel-channel-drawing-tool/"], maxPoints: 3, selectionTextEditor: "line-midpoint", dynamicAlertProjection: "dynamic-channel", settingsFeatures: ["line", "fill", "text", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("flatTopBottom", "Flat top/bottom", "lines", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-a", selectionTextEditor: "line-midpoint", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("disjointChannel", "Disjoint channel", "lines", "trend", "fixed-multi-point", 4, { maxPoints: 4, rollout: "phase8-wave-a", selectionTextEditor: "line-midpoint", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),

  tool("brush", "Brush", "shapes", "brush", "pointer-continuous", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516987-brush-drawing-tool/"], section: "BRUSHES", pointSimplificationTolerance: 0.75 }),
  tool("highlighter", "Highlighter", "shapes", "highlighter", "pointer-continuous", 2, { pointSimplificationTolerance: 0.75, defaultProperties: { lineWidth: 8, opacity: 0.35 } }),
  tool("arrow", "Arrow", "shapes", "arrowUpRight", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518134-arrow-drawing-tool/"], section: "ARROWS" }),
  tool("arrowMarker", "Arrow marker", "shapes", "arrowUpRight", "two-point", 2, { angleConstraint: "45-degree" }),
  tool("arrowMarkUp", "Arrow mark up", "shapes", "arrowUp", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518087-arrow-marks-drawing-tools/"] }),
  tool("arrowMarkDown", "Arrow mark down", "shapes", "arrowDown", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518087-arrow-marks-drawing-tools/"] }),
  tool("arrowMarkLeft", "Arrow mark left", "shapes", "arrowLeft", "one-point", 1, { preferredForCreation: false }),
  tool("arrowMarkRight", "Arrow mark right", "shapes", "arrowRight", "one-point", 1, { preferredForCreation: false }),
  tool("rectangle", "Rectangle", "shapes", "square", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516984-rectangle-drawing-tool/"], shortcuts: [{ key: "4", shiftKey: true }, { key: "r", altKey: true, shiftKey: true }], section: "SHAPES", styleFamily: "shape", selectionTextEditor: "shape-center", angleConstraint: "45-degree", settingsFeatures: ["line", "fill", "text", "middle-line", "coordinates", "visibility", "templates"], alertProjection: "range-boundaries" }),
  tool("rotatedRect", "Rotated rectangle", "shapes", "square", "fixed-multi-point", 2, { maxPoints: 3, styleFamily: "shape", selectionTextEditor: "shape-center", angleConstraint: "45-degree" }),
  tool("path", "Path", "shapes", "path", "click-freeform", 2),
  tool("circle", "Circle", "shapes", "circle", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000662172-circle-drawing-tool/"], styleFamily: "shape", selectionTextEditor: "shape-center", angleConstraint: "45-degree" }),
  tool("ellipse", "Ellipse", "shapes", "circle", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516988-ellipse-drawing-tool/"], styleFamily: "shape", selectionTextEditor: "shape-center", angleConstraint: "45-degree" }),
  tool("polyline", "Polyline", "shapes", "pen", "click-freeform", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516986-polyline-drawing-tool/"], shortcuts: [{ key: "5", shiftKey: true }], styleFamily: "shape", freeformCloseOnFirstPoint: true, settingsFeatures: ["line", "fill", "coordinates", "visibility", "templates"] }),
  tool("triangle", "Triangle", "shapes", "triangle", "fixed-multi-point", 3, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516814-triangle-drawing-tool/"], maxPoints: 3, styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("arc", "Arc", "shapes", "spline", "fixed-multi-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516989-arc-drawing-tool/"], maxPoints: 3, styleFamily: "shape" }),
  tool("curve", "Curve", "shapes", "spline", "click-freeform", 3),
  tool("doubleCurve", "Double curve", "shapes", "doubleCurve", "fixed-multi-point", 2, { maxPoints: 4 }),

  tool("fibRetracement", "Fib Retracement", "fibonacci", "fib", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/"], shortcuts: [{ key: "7", shiftKey: true }], settingsProfile: "fib", alertProjection: "fib-retracement-levels" }),
  tool("fibExtension", "Trend-Based Fib Extension", "fibonacci", "fibExtension", "fixed-multi-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518137-trend-based-fib-extension-drawing-tool/"], maxPoints: 3, settingsProfile: "fib", alertProjection: "fib-extension-levels" }),
  tool("fibTimeZone", "Fib Time Zone", "fibonacci", "fib", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518155-fib-time-zone-drawing-tool/"], rollout: "phase8-wave-a", settingsProfile: "fib" }),
  tool("fibChannel", "Fib Channel", "fibonacci", "fib", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsProfile: "fib", dynamicAlertProjection: "dynamic-fib-channel" }),
  tool("fibSpeedFan", "Fib Speed Resistance Fan", "fibonacci", "fib", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518156-fib-speed-resistance-fan-drawing-tool/"], rollout: "phase8-wave-b", settingsProfile: "fib", angleConstraint: "45-degree" }),
  tool("trendFibTime", "Trend-Based Fib Time", "fibonacci", "fibExtension", "fixed-multi-point", 3, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518136-trend-based-fib-time-drawing-tool/"], maxPoints: 3, rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("fibCircles", "Fib Circles", "fibonacci", "circle", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518159-fib-circles/"], rollout: "phase8-wave-b", settingsProfile: "fib", angleConstraint: "45-degree" }),
  tool("fibSpiral", "Fib Spiral", "fibonacci", "spiral", "two-point", 2, { rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("fibSpeedArcs", "Fib Speed Resistance Arcs", "fibonacci", "fib", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518157-fib-speed-resistance-arcs/"], rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("fibWedge", "Fib Wedge", "fibonacci", "fib", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518153-fib-wedge-drawing-tool/"], rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("pitchfan", "Pitchfan", "fibonacci", "fib", "fixed-multi-point", 3, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518143-pitchfan-drawing-tool/"], maxPoints: 3, rollout: "phase8-wave-b", settingsProfile: "fib" }),
  tool("gannFan", "Gann Fan", "fibonacci", "fib", "two-point", 2, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000518151-gann-fan-drawing-tool/"],
    rollout: "phase8-wave-b",
    gannFamily: "fan",
    gannScaleConstraint: "price-bar-ratio",
    defaultProperties: {
      lineWidth: 1.5,
      gann: cloneGannConfig(DEFAULT_GANN_FAN_CONFIG),
    },
    settingsFeatures: ["line", "gann", "coordinates", "visibility", "templates"],
  }),
  tool("gannSquare", "Gann Square", "fibonacci", "square", "two-point", 2, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000518149-gann-square-drawing-tool/"],
    rollout: "phase8-wave-b",
    styleFamily: "shape",
    gannFamily: "square",
    gannScaleConstraint: "price-bar-ratio",
    defaultProperties: {
      lineWidth: 1.5,
      gann: cloneGannConfig(DEFAULT_GANN_SQUARE_CONFIG),
    },
    settingsFeatures: ["line", "gann", "coordinates", "visibility", "templates"],
  }),
  tool("gannBox", "Gann Box", "fibonacci", "square", "two-point", 2, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000518152-gann-box-drawing-tool/"],
    rollout: "phase8-wave-b",
    styleFamily: "shape",
    gannFamily: "box",
    gannScaleConstraint: "price-bar-ratio",
    defaultProperties: {
      lineWidth: 1.5,
      gann: cloneGannConfig(DEFAULT_GANN_BOX_CONFIG),
    },
    settingsFeatures: ["line", "gann", "coordinates", "visibility", "templates"],
  }),
  tool("pitchfork", "Pitchfork", "lines", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("insidePitchfork", "Inside Pitchfork", "lines", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("schiffPitchfork", "Schiff Pitchfork", "lines", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
  tool("modifiedSchiffPitchfork", "Modified Schiff Pitchfork", "lines", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-b", settingsFeatures: ["line", "fill", "channel-levels", "coordinates", "visibility", "templates"] }),
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
  tool("anchoredVWAP", "Anchored VWAP", "lines", "trend", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000669764-anchored-vwap-drawing-tool/"], rollout: "phase8-wave-d", dataSnapshot: "anchor-to-latest" }),
  tool("regressionTrend", "Regression Trend", "lines", "trend", "two-point", 2, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000518108-regression-trend-drawing-tool/"],
    rollout: "phase8-wave-d",
    dataSnapshot: "between-anchors",
    coordinatePriceEditable: false,
    coordinateLabels: ["Point 1", "Point 2"],
    defaultProperties: {
      lineWidth: 1.5,
      ...DEFAULT_REGRESSION_TREND_CONFIG,
    },
    settingsFeatures: [
      "regression-inputs",
      "line",
      "regression-style",
      "coordinates",
      "visibility",
      "templates",
    ],
  }),
  tool("fixedVolumeProfile", "Fixed Range Volume Profile", "measurements", "ruler", "two-point", 2, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000707985-fixed-range-volume-profile-drawing-tool/", "https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/"],
    rollout: "phase8-wave-d",
    dataSnapshot: "between-anchors",
    dataSnapshotDetail: "volume-profile",
    styleFamily: "shape",
    defaultProperties: {
      lineWidth: 1.5,
      ...DEFAULT_VOLUME_PROFILE_CONFIG,
    },
    settingsFeatures: ["volume-profile-inputs", "line", "fill", "volume-profile-style", "coordinates", "visibility", "templates"],
  }),
  tool("anchoredVolumeProfile", "Anchored Volume Profile", "measurements", "ruler", "one-point", 1, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000707989-anchored-volume-profile-drawing-tool/", "https://www.tradingview.com/support/solutions/43000502040-volume-profile-indicators-basic-concepts/"],
    rollout: "phase8-wave-d",
    dataSnapshot: "anchor-to-latest",
    dataSnapshotDetail: "volume-profile",
    styleFamily: "shape",
    defaultProperties: {
      lineWidth: 1.5,
      ...DEFAULT_VOLUME_PROFILE_CONFIG,
    },
    settingsFeatures: ["volume-profile-inputs", "line", "fill", "volume-profile-style", "coordinates", "visibility", "templates"],
  }),
  tool("barsPattern", "Bars Pattern", "measurements", "path", "two-point", 2, { rollout: "phase8-wave-d", dataSnapshot: "between-anchors" }),
  tool("ghostFeed", "Ghost Feed", "measurements", "path", "two-point", 2, { rollout: "phase8-wave-d", dataSnapshot: "between-anchors" }),
  tool("forecast", "Forecast", "measurements", "trend", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-d", styleFamily: "shape", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("sector", "Sector", "measurements", "spline", "fixed-multi-point", 3, { maxPoints: 3, rollout: "phase8-wave-d", styleFamily: "shape", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("priceRange", "Price range", "measurements", "ruler", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("dateRange", "Date range", "measurements", "ruler", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("datePriceRange", "Date and price range", "measurements", "ruler", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center", settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("long", "Long position", "positions", "long", "one-point", 1, { shortcuts: [{ key: "8", shiftKey: true }], settingsOverlay: "position-dialog", lifecycleExtension: "position-resolution", settingsProfile: "position", positionSide: "long", viewportCulling: "always-render", coordinateLabels: ["Entry", "Target", "Stop"], alertProjection: "position-levels" }),
  tool("short", "Short position", "positions", "short", "one-point", 1, { shortcuts: [{ key: "9", shiftKey: true }], settingsOverlay: "position-dialog", lifecycleExtension: "position-resolution", settingsProfile: "position", positionSide: "short", viewportCulling: "always-render", coordinateLabels: ["Entry", "Target", "Stop"], alertProjection: "position-levels" }),
  tool("text", "Text", "annotations", "text", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516983-text-drawing-tool/"], shortcuts: [{ key: "6", shiftKey: true }], styleFamily: "text", overlayExtension: "text-editor" }),
  tool("emoji", "Emoji", "icons", "emoji", "one-point", 1, {
    officialDocs: ["https://www.tradingview.com/support/solutions/43000662396-how-to-chart-with-emojis/"],
    styleFamily: "text",
    defaultProperties: { lineWidth: 1.5, text: "😊", fontSize: 32 },
  }),
  tool("note", "Note", "annotations", "text", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000737571-note-drawing-tool/"], rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("priceNote", "Price note", "annotations", "text", "two-point", 2, { rollout: "phase8-wave-a", styleFamily: "text", selectionTextEditor: "line-midpoint", angleConstraint: "45-degree", settingsFeatures: ["line", "text", "coordinates", "visibility", "templates"], alertProjection: "point-price" }),
  tool("pin", "Pin", "annotations", "pin", "one-point", 1, { rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("table", "Table", "annotations", "square", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000744162-table-drawing-tool/"], rollout: "phase8-wave-d", contentKind: "table", styleFamily: "shape", defaultProperties: { lineWidth: 1.5, content: { kind: "table", cells: [["Header", "Value"], ["Row", "—"]] } }, settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("callout", "Callout", "annotations", "text", "two-point", 2, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516978-callout-drawing-tool/"], rollout: "phase8-wave-a", styleFamily: "shape", selectionTextEditor: "shape-center" }),
  tool("comment", "Comment", "annotations", "text", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000516981-comment-drawing-tool/"], rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("priceLabel", "Price label", "annotations", "text", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518083-price-label/"], rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor", alertProjection: "point-price" }),
  tool("signpost", "Signpost", "annotations", "text", "one-point", 1, { rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("flag", "Flag mark", "annotations", "text", "one-point", 1, { officialDocs: ["https://www.tradingview.com/support/solutions/43000518085-flag-mark-drawing-tool/"], rollout: "phase8-wave-a", styleFamily: "text", overlayExtension: "text-editor" }),
  tool("image", "Image", "annotations", "square", "two-point", 2, { rollout: "phase8-wave-d", contentKind: "image", styleFamily: "shape", defaultProperties: { lineWidth: 1.5, content: { kind: "image", alt: "Image" } }, settingsFeatures: ["line", "fill", "text", "coordinates", "visibility", "templates"] }),
  tool("socialEmbed", "X post / idea", "annotations", "text", "one-point", 1, { rollout: "phase8-wave-d", contentKind: "social", styleFamily: "text", overlayExtension: "text-editor" }),
] satisfies readonly DrawingToolManifestEntry[]);

export const DRAWING_TOOL_GROUPS = Object.freeze([
  { id: "cursor", label: "Cursor", iconKey: "crosshair", defaultTool: "crosshair" },
  { id: "lines", label: "Trend line", iconKey: "trend", defaultTool: "trendline" },
  { id: "shapes", label: "Rectangle", iconKey: "square", defaultTool: "rectangle" },
  { id: "fibonacci", label: "Fib Retracement", iconKey: "fib", defaultTool: "fibRetracement" },
  { id: "patterns", label: "Patterns", iconKey: "vertical", defaultTool: "cyclicLines" },
  { id: "measurements", label: "Ranges", iconKey: "ruler", defaultTool: "datePriceRange" },
  { id: "positions", label: "Long position", iconKey: "long", defaultTool: "long" },
  { id: "annotations", label: "Text", iconKey: "text", defaultTool: "text" },
  { id: "icons", label: "Icons", iconKey: "emoji", defaultTool: "emoji" },
] satisfies readonly DrawingToolGroupDefinition[]);

const manifestById = new Map<DrawingTool, DrawingToolManifestEntry>();
const toolByShortcut = new Map<string, DrawingTool>();

function shortcutSignature(shortcut: DrawingToolShortcut): string {
  const key = shortcut.key.length === 1
    ? shortcut.key.toLowerCase()
    : shortcut.key;
  return [
    shortcut.ctrlKey === true ? "ctrl" : "",
    shortcut.metaKey === true ? "meta" : "",
    shortcut.altKey === true ? "alt" : "",
    shortcut.shiftKey === true ? "shift" : "",
    key,
  ].join("+");
}

for (const definition of DRAWING_TOOL_MANIFEST) {
  if (manifestById.has(definition.id)) throw new Error(`Duplicate drawing tool id: ${definition.id}`);
  manifestById.set(definition.id, definition);
  for (const shortcut of definition.shortcuts) {
    const signature = shortcutSignature(shortcut);
    const existing = toolByShortcut.get(signature);
    if (existing) {
      throw new Error(
        `Duplicate drawing tool shortcut ${formatDrawingToolShortcut(shortcut)}: ${existing}, ${definition.id}`,
      );
    }
    toolByShortcut.set(signature, definition.id);
  }
}
if (manifestById.size !== ALL_DRAWING_TOOL_IDS.length || ALL_DRAWING_TOOL_IDS.some((id) => !manifestById.has(id))) {
  throw new Error("Drawing tool manifest is incomplete");
}

export function getDrawingToolManifestEntry(toolId: DrawingTool): DrawingToolManifestEntry {
  const definition = manifestById.get(toolId);
  if (!definition) throw new Error(`Unknown drawing tool: ${toolId}`);
  return definition;
}

/** Resolve a key event shape without duplicating tool knowledge in UI hooks. */
export function getDrawingToolForShortcut(
  shortcut: DrawingToolShortcut,
): DrawingTool | undefined {
  return toolByShortcut.get(shortcutSignature(shortcut));
}

export function formatDrawingToolShortcut(
  shortcut: DrawingToolShortcut,
): string {
  const parts: string[] = [];
  if (shortcut.ctrlKey) parts.push("Ctrl");
  if (shortcut.metaKey) parts.push("Meta");
  if (shortcut.altKey) parts.push("Alt");
  if (shortcut.shiftKey) parts.push("Shift");
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts.join(" + ");
}

export function getDrawingToolPositionSide(
  toolId: DrawingTool,
): "long" | "short" | undefined {
  return getDrawingToolManifestEntry(toolId).positionSide;
}

/** Creation-only kill switch. Adapters/codecs remain active for saved drawings. */
export function isDrawingToolCreationEnabled(
  toolId: DrawingTool,
  phase8WaveAEnabled = process.env.NEXT_PUBLIC_DRAWING_PHASE8_WAVE_A !== "false",
  phase8WaveBEnabled = process.env.NEXT_PUBLIC_DRAWING_PHASE8_WAVE_B !== "false",
  phase8WaveCEnabled = process.env.NEXT_PUBLIC_DRAWING_PHASE8_WAVE_C !== "false",
  phase8WaveDEnabled = process.env.NEXT_PUBLIC_DRAWING_PHASE8_WAVE_D !== "false",
): boolean {
  const definition = getDrawingToolManifestEntry(toolId);
  if (definition.rollout === "phase8-wave-a") return phase8WaveAEnabled;
  if (definition.rollout === "phase8-wave-b") return phase8WaveBEnabled;
  if (definition.rollout === "phase8-wave-c") return phase8WaveCEnabled;
  if (definition.rollout === "phase8-wave-d") return phase8WaveDEnabled;
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
