/** User drawing primitives rendered on the chart overlay canvas. */

export type DrawingTool =
  // modes (do not create a drawing)
  | "cursor"
  | "crosshair"
  | "eraser"
  | "measure"
  // line tools
  | "trendline"
  | "ray"
  | "extendedLine"
  | "trendAngle"
  | "horizontal"
  | "horizRay"
  | "vertical"
  | "crossLine"
  | "infoLine"
  | "channel"
  // shape tools
  | "rectangle"
  | "rotatedRect"
  | "circle"
  | "ellipse"
  | "triangle"
  | "polyline"
  | "curve"
  | "doubleCurve"
  | "arc"
  | "path"
  | "fib"
  | "fibRetracement"
  | "fibExtension"
  // annotations
  | "text"
  | "emoji"
  // positions
  | "long"
  | "short"
  // freehand
  | "brush";

/** Tools that actually persist a drawing object (vs. interaction modes). */
export const DRAWING_TOOLS: DrawingTool[] = [
  "trendline",
  "ray",
  "extendedLine",
  "trendAngle",
  "horizontal",
  "horizRay",
  "vertical",
  "crossLine",
  "infoLine",
  "channel",
  "rectangle",
  "rotatedRect",
  "circle",
  "ellipse",
  "triangle",
  "polyline",
  "curve",
  "doubleCurve",
  "arc",
  "path",
  "fib",
  "fibRetracement",
  "fibExtension",
  "text",
  "emoji",
  "long",
  "short",
  "brush",
];

export type LineStyle = "solid" | "dashed" | "dotted";

/**
 * Optional metrics the Long/Short position tool can append to its on-chart
 * labels (TradingView's "Stats" multi-select). `percent` = price offset %,
 * `ticks` = offset in ticks, `rr` = risk/reward, `amount` = money P/L (needs
 * account + risk configured).
 */
export type PositionStat = "percent" | "ticks" | "rr" | "amount";

/** All position stats in display order, with human labels for the dropdown. */
export const POSITION_STATS: { id: PositionStat; label: string }[] = [
  { id: "percent", label: "TP/SL price offset, %" },
  { id: "ticks", label: "TP/SL price offset, ticks" },
  { id: "rr", label: "Risk/Reward ratio" },
  { id: "amount", label: "Risk/Reward amount" },
];

export type FibTextMode = "values" | "percent";
export type FibAlignH = "left" | "center" | "right";
export type FibAlignV = "top" | "middle" | "bottom";

export interface FibLevelConfig {
  value: number;
  enabled: boolean;
  color: string;
  text?: string;
}

export interface Point {
  /** UTC timestamp (seconds). */
  time: number;
  price: number;
}

export interface BaseDrawing {
  id: string;
  tool: DrawingTool;
  color: string;
  lineWidth: number;
  points: Point[];
  text?: string;
  /** Font size (px) for text / emoji annotations. Defaults to 13. */
  fontSize?: number;
  /** Line style: solid (default), dashed, or dotted. */
  lineStyle?: LineStyle;
  /** Fill color for shapes (rectangle, circle, etc.). */
  fillColor?: string;
  /** Fill opacity (0–1). */
  opacity?: number;
  /** Stacking order; higher renders on top. */
  zIndex?: number;
  locked?: boolean;
  visible?: boolean;
  /** Position tools (long/short): stop-loss & take-profit price levels. */
  stop?: number;
  target?: number;
  /** Long/Short position tool settings (TradingView-style). */
  accountSize?: number;
  accountCurrency?: string;
  lotSize?: number;
  /** Risk value — interpreted as % of account or absolute amount per `riskUnit`. */
  riskValue?: number;
  riskUnit?: "%" | "amount";
  leverage?: number;
  /** Decimal places for the computed position quantity. */
  qtyPrecision?: number;
  /** Whether the on-chart info labels are shown (default true). */
  showLabels?: boolean;
  /** Position tool — stop/loss zone & line colour (default TradingView red). */
  stopColor?: string;
  /** Position tool — target/profit zone & line colour (default TV green). */
  targetColor?: string;
  /** Position tool — which extra stats appear on the labels. */
  positionStats?: PositionStat[];
  /** Position tool — render the stat chips in a tighter, abbreviated form. */
  compactStats?: boolean;
  /** Position tool — keep stats visible even when the tool isn't selected. */
  alwaysShowStats?: boolean;
  /** Fibonacci object settings (TradingView-style). */
  fibTrendLine?: boolean;
  fibTrendLineColor?: string;
  fibTrendLineWidth?: number;
  fibTrendLineStyle?: LineStyle;
  fibLevelsLine?: boolean;
  fibLevelLineColor?: string;
  fibLevelLineWidth?: number;
  fibLevelLineStyle?: LineStyle;
  fibLevels?: FibLevelConfig[];
  fibUseOneColor?: boolean;
  fibBackground?: boolean;
  fibReverse?: boolean;
  fibShowPrices?: boolean;
  fibShowLevels?: boolean;
  fibLevelsFormat?: FibTextMode;
  fibLabelsHAlign?: FibAlignH;
  fibLabelsVAlign?: FibAlignV;
  fibShowText?: boolean;
  fibTextHAlign?: FibAlignH;
  fibTextVAlign?: FibAlignV;
  fibLogScale?: boolean;
  // --- TradingView object-settings parity (shapes & text) ---
  /** Bold / italic for text (text tool + text inside a shape). */
  bold?: boolean;
  italic?: boolean;
  /** Horizontal alignment of a shape's inner text. */
  textHAlign?: "left" | "center" | "right";
  /** Vertical alignment of a shape's inner text. */
  textVAlign?: "top" | "middle" | "bottom";
  /** Color of a shape's inner text (falls back to `color`). */
  textColor?: string;
  /** Shape extension across the chart (rectangle): none/left/right/both. */
  extend?: "none" | "left" | "right" | "both";
  /** Draw a horizontal middle line through a rectangle. */
  showMiddleLine?: boolean;
  middleLineColor?: string;
  middleLineStyle?: LineStyle;
  /** Position tool trade lifecycle status. */
  tradeStatus?: "pending" | "running" | "tp_hit" | "sl_hit";
  /** UNIX time (seconds) of the candle that first hit TP or SL. */
  hitTime?: number;
  /** Price level at which the hit occurred (target or stop price). */
  hitPrice?: number;
  /**
   * Transient render-only flag: true on the cloned drawing the renderer builds
   * from live drag points. Tools use it to suppress mid-drag side effects (e.g.
   * the position tool's TP/SL hit-freeze that would otherwise snap-extend the
   * box width while the user is still dragging). Never persisted to the store.
   */
  _dragging?: boolean;
}

export type Drawing = BaseDrawing;

/**
 * Style families used for the floating toolbar settings/templates. A template
 * saved from a shape can only be applied to another shape, etc. (TradingView
 * scopes its style templates the same way).
 */
export type StyleFamily = "line" | "shape" | "text";

/** Tools that carry a fill (shapes) → the "shape" style family. */
export const SHAPE_TOOLS: DrawingTool[] = [
  "rectangle",
  "rotatedRect",
  "circle",
  "ellipse",
  "triangle",
];

/** Map a tool to its style family for settings/templates. */
export function styleFamily(tool: DrawingTool): StyleFamily {
  if (tool === "text" || tool === "emoji") return "text";
  if (SHAPE_TOOLS.includes(tool)) return "shape";
  return "line";
}

/**
 * A reusable style preset ("template") the user can save from one object and
 * apply to another of the same family. Style-only — never points / id — so a
 * bad template can't move or duplicate objects.
 */
export interface DrawingTemplate {
  name: string;
  family: StyleFamily;
  color: string;
  lineWidth?: number;
  lineStyle?: LineStyle;
  fillColor?: string;
  opacity?: number;
  fontSize?: number;
  showLabels?: boolean;
  bold?: boolean;
  italic?: boolean;
  textColor?: string;
  textHAlign?: "left" | "center" | "right";
  textVAlign?: "top" | "middle" | "bottom";
  extend?: "none" | "left" | "right" | "both";
  showMiddleLine?: boolean;
  middleLineColor?: string;
  middleLineStyle?: LineStyle;
  fibTrendLine?: boolean;
  fibTrendLineColor?: string;
  fibTrendLineWidth?: number;
  fibTrendLineStyle?: LineStyle;
  fibLevelsLine?: boolean;
  fibLevelLineColor?: string;
  fibLevelLineWidth?: number;
  fibLevelLineStyle?: LineStyle;
  fibLevels?: FibLevelConfig[];
  fibUseOneColor?: boolean;
  fibBackground?: boolean;
  fibReverse?: boolean;
  fibShowPrices?: boolean;
  fibShowLevels?: boolean;
  fibLevelsFormat?: FibTextMode;
  fibLabelsHAlign?: FibAlignH;
  fibLabelsVAlign?: FibAlignV;
  fibShowText?: boolean;
  fibTextHAlign?: FibAlignH;
  fibTextVAlign?: FibAlignV;
  fibLogScale?: boolean;
}

/** The subset of `Drawing` fields a template applies. */
export const TEMPLATE_STYLE_KEYS = [
  "color",
  "lineWidth",
  "lineStyle",
  "fillColor",
  "opacity",
  "fontSize",
  "showLabels",
  "bold",
  "italic",
  "textColor",
  "textHAlign",
  "textVAlign",
  "extend",
  "showMiddleLine",
  "middleLineColor",
  "middleLineStyle",
  "fibTrendLine",
  "fibTrendLineColor",
  "fibTrendLineWidth",
  "fibTrendLineStyle",
  "fibLevelsLine",
  "fibLevelLineColor",
  "fibLevelLineWidth",
  "fibLevelLineStyle",
  "fibLevels",
  "fibUseOneColor",
  "fibBackground",
  "fibReverse",
  "fibShowPrices",
  "fibShowLevels",
  "fibLevelsFormat",
  "fibLabelsHAlign",
  "fibLabelsVAlign",
  "fibShowText",
  "fibTextHAlign",
  "fibTextVAlign",
  "fibLogScale",
] as const;

export const DEFAULT_FIB_LEVELS: readonly FibLevelConfig[] = [
  { value: 0, enabled: true, color: "#787b86" },
  { value: 0.236, enabled: true, color: "#f23645" },
  { value: 0.382, enabled: true, color: "#ff9800" },
  { value: 0.5, enabled: true, color: "#4caf50" },
  { value: 0.618, enabled: true, color: "#089981" },
  { value: 0.786, enabled: true, color: "#00bcd4" },
  { value: 1, enabled: true, color: "#787b86" },
  { value: 1.618, enabled: true, color: "#2962ff" },
  { value: 2.618, enabled: true, color: "#f23645" },
  { value: 3.618, enabled: true, color: "#9c27b0" },
  { value: 4.236, enabled: true, color: "#e91e63" },
  { value: 1.272, enabled: false, color: "#9d6b16" },
  { value: 1.414, enabled: false, color: "#a33a43" },
  { value: 2.272, enabled: false, color: "#a66a16" },
  { value: 2.414, enabled: false, color: "#3d7b45" },
  { value: 2, enabled: false, color: "#176d62" },
  { value: 3, enabled: false, color: "#278a96" },
  { value: 3.272, enabled: false, color: "#666666" },
  { value: 3.414, enabled: false, color: "#2f55a4" },
  { value: 4, enabled: false, color: "#a33a43" },
  { value: 4.272, enabled: false, color: "#6f2f84" },
  { value: 4.414, enabled: false, color: "#9b2a56" },
  { value: 4.618, enabled: false, color: "#a66a16" },
  { value: 4.764, enabled: false, color: "#176d62" },
] as const;

/** Enabled default ratios for legacy code paths. */
export const FIB_LEVELS = DEFAULT_FIB_LEVELS.filter((level) => level.enabled).map(
  (level) => level.value,
);

/** TradingView-style trend-based Fibonacci extension ratios. */
export const FIB_EXT_LEVELS = [
  0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.414, 1.618, 2, 2.618, 3.618,
  4.236,
] as const;

/** Tools whose icon should look "pressed" but that don't add a persistent object. */
export const MODE_TOOLS: DrawingTool[] = [
  "cursor",
  "crosshair",
  "eraser",
  "measure",
];
