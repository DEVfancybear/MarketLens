/**
 * DrawingRenderer — pure canvas rendering for drawing objects.
 *
 * Delegates to per-tool adapters via getAdapter(). No giant switch.
 * To add a tool, register an adapter in adapters.ts — this file never changes.
 *
 * All geometry is stored in (time, price) space; the projector converts to
 * pixels so drawings stay pinned through zoom / pan / resize / timeframe change.
 */
import type { Drawing, LineStyle } from "@/types";
import { getTool } from "./tools/ToolRegistry";

// Import adapters to trigger registration.
import "./tools/adapters";

export interface DrawingMarketContext {
  symbol: string;
  candles: readonly { time: number; close: number; high: number; low: number }[];
  /** Resolved IANA display zone. Drawing coordinates themselves remain UTC. */
  timeZone?: string;
  tickSize?: number;
  pricePrecision?: number;
  pointValue?: number;
}

export interface Projector {
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  width: number;
  height: number;
  /** Active chart bar duration supplied by the composition root. */
  barIntervalSeconds?: number;
  /** Read-only market inputs for adapters whose pixels include live metrics. */
  market?: DrawingMarketContext;
}

/** Apply lineStyle to the canvas context before stroking. */
export function applyStyle(
  g: CanvasRenderingContext2D,
  style: LineStyle | undefined,
) {
  if (style === "dashed") g.setLineDash([6, 3]);
  else if (style === "dotted") g.setLineDash([2, 3]);
  else g.setLineDash([]);
}

/** Render a single drawing. Caller sets strokeStyle/lineWidth defaults. */
export function renderDrawing(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
  selected: boolean,
) {
  const adapter = getTool(d.tool);
  if (!adapter) return;

  g.strokeStyle = d.color;
  g.fillStyle = d.color;
  g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.5 : 1);
  applyStyle(g, d.lineStyle);

  adapter.render(g, d, proj, selected);
}
