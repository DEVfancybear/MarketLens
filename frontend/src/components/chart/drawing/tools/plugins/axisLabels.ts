import type { Drawing } from "@/types";
import type { Projector } from "../../drawingRenderer";
import { canvasFont } from "./shared";

const LABEL_HEIGHT = 20;
const EDGE_GAP = 3;
const HORIZONTAL_PADDING = 8;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

function drawLabel(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  g.save();
  g.setLineDash([]);
  g.font = canvasFont(11, { weight: 600 });
  const width = Math.ceil(g.measureText(text).width + HORIZONTAL_PADDING * 2);
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

export function drawPriceAxisLabel(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, y: number) {
  const text = formatAxisPrice(d.points[0].price, proj);
  g.save();
  g.font = canvasFont(11, { weight: 600 });
  const width = Math.ceil(g.measureText(text).width + HORIZONTAL_PADDING * 2);
  g.restore();
  drawLabel(g, text, Math.max(0, proj.width - width - EDGE_GAP), Math.max(0, Math.min(y - LABEL_HEIGHT / 2, proj.height - LABEL_HEIGHT)), d.color);
}

export function drawTimeAxisLabel(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, x: number) {
  const text = formatAxisTime(d.points[0].time);
  g.save();
  g.font = canvasFont(11, { weight: 600 });
  const width = Math.min(Math.ceil(g.measureText(text).width + HORIZONTAL_PADDING * 2), Math.max(36, proj.width - 8));
  g.restore();
  const labelX = Math.max(4, Math.min(x - width / 2, proj.width - width - 4));
  drawLabel(g, text, labelX, Math.max(0, proj.height - LABEL_HEIGHT - EDGE_GAP), d.color);
}
