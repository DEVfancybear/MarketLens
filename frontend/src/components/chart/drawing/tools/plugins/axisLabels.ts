import type { Drawing } from "@/types";
import type { Projector } from "../../drawingRenderer";
import { canvasFont } from "./shared";

const LABEL_HEIGHT = 20;
const EDGE_GAP = 3;
const HORIZONTAL_PADDING = 8;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface AxisLabelRect {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatAxisTime(timeSec: number): string {
  const date = new Date(timeSec * 1000);
  return `${WEEKDAYS[date.getUTCDay()]} ${pad2(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ${pad2(date.getUTCFullYear() % 100)} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

export function formatAxisPrice(price: number, proj: Projector): string {
  const precision = proj.market?.pricePrecision;
  if (precision != null && Number.isInteger(precision) && precision >= 0 && precision <= 12) {
    return price.toFixed(precision);
  }
  const tick = proj.market?.tickSize;
  if (tick && Number.isFinite(tick) && tick > 0) {
    const decimals = Math.max(0, Math.min(12, Math.ceil(-Math.log10(tick))));
    return price.toFixed(decimals);
  }
  return price.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function roundedRect(g: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const radius = 2;
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + width, y, x + width, y + height, radius);
  g.arcTo(x + width, y + height, x, y + height, radius);
  g.arcTo(x, y + height, x, y, radius);
  g.arcTo(x, y, x + width, y, radius);
  g.closePath();
}

function drawLabel(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  resolvedWidth?: number,
) {
  g.save();
  g.setLineDash([]);
  g.font = canvasFont(11, { weight: 600 });
  const width = resolvedWidth ?? Math.ceil(g.measureText(text).width + HORIZONTAL_PADDING * 2);
  roundedRect(g, x, y, width, LABEL_HEIGHT);
  g.fillStyle = color;
  g.fill();
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, x + width / 2, y + LABEL_HEIGHT / 2 + 0.5);
  g.restore();
  return width;
}

/**
 * Resolve the exact CSS-pixel rectangle used by the price badge.  Keeping the
 * calculation outside the renderer lets the DOM overlay expose the same hit
 * target for direct on-chart text editing (and keeps hit/render geometry in
 * lockstep when precision or viewport size changes).
 */
export function priceAxisLabelRect(
  d: Drawing,
  proj: Pick<Projector, "width" | "height" | "market">,
  y: number,
): AxisLabelRect {
  return priceAxisValueLabelRect(
    d.points[0]?.price ?? 0,
    proj,
    y,
  );
}

/** Resolve a price-axis badge for any capability-owned price value. */
export function priceAxisValueLabelRect(
  price: number,
  proj: Pick<Projector, "width" | "height" | "market">,
  y: number,
): AxisLabelRect {
  const text = formatAxisPrice(price, proj as Projector);
  // Canvas and DOM measure text using the same font family/size.  The caller
  // may use a real canvas context for an exact width; this conservative width
  // is intentionally the same padding contract as drawLabel.
  const width = Math.max(
    24,
    Math.ceil(text.length * 7 + HORIZONTAL_PADDING * 2),
  );
  return {
    text,
    x: Math.max(0, proj.width - width - EDGE_GAP),
    y: Math.max(0, Math.min(y - LABEL_HEIGHT / 2, proj.height - LABEL_HEIGHT)),
    width,
    height: LABEL_HEIGHT,
  };
}

export function timeAxisLabelRect(
  d: Drawing,
  proj: Pick<Projector, "width" | "height" | "market">,
  x: number,
): AxisLabelRect {
  const text = formatAxisTime(d.points[0]?.time ?? 0);
  const width = Math.min(
    Math.max(36, Math.ceil(text.length * 7 + HORIZONTAL_PADDING * 2)),
    Math.max(36, proj.width - 8),
  );
  return {
    text,
    x: Math.max(4, Math.min(x - width / 2, proj.width - width - 4)),
    y: Math.max(0, proj.height - LABEL_HEIGHT - EDGE_GAP),
    width,
    height: LABEL_HEIGHT,
  };
}

export function drawPriceAxisLabel(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, y: number) {
  drawPriceAxisValueLabel(g, d.points[0]?.price ?? 0, d.color, proj, y);
}

/** Draw line-family endpoint values on the real price scale, not anchor chips. */
export function drawPriceAxisValueLabel(
  g: CanvasRenderingContext2D,
  price: number,
  color: string,
  proj: Projector,
  y: number,
) {
  const rect = priceAxisValueLabelRect(price, proj, y);
  drawLabel(g, rect.text, rect.x, rect.y, color, rect.width);
}

export function drawTimeAxisLabel(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, x: number) {
  const rect = timeAxisLabelRect(d, proj, x);
  drawLabel(g, rect.text, rect.x, rect.y, d.color, rect.width);
}
