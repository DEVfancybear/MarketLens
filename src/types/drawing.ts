/** User drawing primitives rendered on the chart overlay canvas. */

export type DrawingTool =
  // modes (do not create a drawing)
  | 'cursor'
  | 'crosshair'
  | 'eraser'
  | 'measure'
  // line tools
  | 'trendline'
  | 'horizontal'
  | 'vertical'
  | 'channel'
  // shapes
  | 'rectangle'
  | 'fib'
  // annotations
  | 'text'
  | 'emoji'
  // positions
  | 'long'
  | 'short'
  // freehand
  | 'brush';

/** Tools that actually persist a drawing object (vs. interaction modes). */
export const DRAWING_TOOLS: DrawingTool[] = [
  'trendline', 'horizontal', 'vertical', 'channel',
  'rectangle', 'fib', 'text', 'emoji', 'long', 'short', 'brush',
];

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
export const MODE_TOOLS: DrawingTool[] = ['cursor', 'crosshair', 'eraser', 'measure'];
