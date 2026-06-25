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
}

export type Drawing = BaseDrawing;

/** Standard Fibonacci retracement ratios. */
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Tools whose icon should look "pressed" but that don't add a persistent object. */
export const MODE_TOOLS: DrawingTool[] = [
  "cursor",
  "crosshair",
  "eraser",
  "measure",
];
