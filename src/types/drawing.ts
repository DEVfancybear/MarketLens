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
  /** Position tool trade lifecycle status. */
  tradeStatus?: "pending" | "running" | "tp_hit" | "sl_hit";
  /** UNIX time (seconds) of the candle that first hit TP or SL. */
  hitTime?: number;
  /** Price level at which the hit occurred (target or stop price). */
  hitPrice?: number;
}

export type Drawing = BaseDrawing;

/** Standard Fibonacci retracement ratios. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Standard Fibonacci extension / expansion ratios (projected beyond B). */
export const FIB_EXT_LEVELS = [
  -0.272, -0.618, 0, 0.618, 1, 1.272, 1.382, 1.618, 2, 2.618,
] as const;

/** Tools whose icon should look "pressed" but that don't add a persistent object. */
export const MODE_TOOLS: DrawingTool[] = [
  "cursor",
  "crosshair",
  "eraser",
  "measure",
];
