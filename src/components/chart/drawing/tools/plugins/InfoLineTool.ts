/**
 * InfoLineTool - TradingView-style measurement line with a multi-row stats panel.
 */
import { getDefaultStore } from "jotai";
import { timeframeAtom } from "@/store/chartStore";
import { TF_SECONDS, type Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
} from "../ToolRegistry";
import { line, handle, angleDeg, canvasFont } from "./shared";

const PANEL_W = 246;
const PANEL_H = 92;
const PANEL_PAD = 12;
const ROW_H = 28;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function fmtDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function fmtPriceDelta(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(2);
  if (abs >= 10) return value.toFixed(4);
  if (abs >= 1) return value.toFixed(3);
  return value.toFixed(3);
}

function inferTick(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 100) return 0.01;
  if (abs >= 1) return 0.0001;
  return 0.00001;
}

function panelPosition(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  proj: Projector,
): { x: number; y: number } {
  const midX = (x1 + x2) / 2;
  const below = Math.max(y1, y2) + 16;
  const above = Math.min(y1, y2) - PANEL_H - 16;
  const preferredY = below + PANEL_H <= proj.height - 6 ? below : above;
  return {
    x: clamp(midX + 12, 6, Math.max(6, proj.width - PANEL_W - 6)),
    y: clamp(preferredY, 6, Math.max(6, proj.height - PANEL_H - 6)),
  };
}

function drawRoundedRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawInfoIcon(
  g: CanvasRenderingContext2D,
  kind: "price" | "bars" | "angle",
  x: number,
  y: number,
) {
  g.save();
  g.strokeStyle = "#f0f3fa";
  g.fillStyle = "#f0f3fa";
  g.lineWidth = 1.2;
  g.setLineDash([]);
  if (kind === "price") {
    g.beginPath();
    g.moveTo(x + 7, y + 5);
    g.lineTo(x + 7, y + 19);
    g.moveTo(x + 3, y + 8);
    g.lineTo(x + 7, y + 4);
    g.lineTo(x + 11, y + 8);
    g.moveTo(x + 3, y + 16);
    g.lineTo(x + 7, y + 20);
    g.lineTo(x + 11, y + 16);
    g.stroke();
  } else if (kind === "bars") {
    g.beginPath();
    g.moveTo(x + 1, y + 12);
    g.lineTo(x + 14, y + 12);
    g.moveTo(x + 1, y + 7);
    g.lineTo(x + 1, y + 17);
    g.moveTo(x + 14, y + 7);
    g.lineTo(x + 14, y + 17);
    g.moveTo(x + 4, y + 8);
    g.lineTo(x + 1, y + 12);
    g.lineTo(x + 4, y + 16);
    g.moveTo(x + 11, y + 8);
    g.lineTo(x + 14, y + 12);
    g.lineTo(x + 11, y + 16);
    g.stroke();
  } else {
    g.beginPath();
    g.moveTo(x + 2, y + 18);
    g.lineTo(x + 15, y + 18);
    g.moveTo(x + 3, y + 18);
    g.lineTo(x + 12, y + 8);
    g.stroke();
    g.beginPath();
    g.arc(x + 3, y + 18, 8, -0.8, 0);
    g.stroke();
  }
  g.restore();
}

function renderInfoPanel(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const diff = d.points[1].price - d.points[0].price;
  const pct = d.points[0].price ? (diff / d.points[0].price) * 100 : 0;
  const tickSpan = Math.abs(diff) / inferTick(d.points[0].price);
  const distance = Math.round(Math.hypot(x2 - x1, y2 - y1));
  const tf = getDefaultStore().get(timeframeAtom);
  const tfSeconds = TF_SECONDS[tf] || 60;
  const elapsed = Math.abs(d.points[1].time - d.points[0].time);
  const bars = Math.max(1, Math.round(elapsed / tfSeconds));
  const angle = Math.abs(angleDeg(x1, y1, x2, y2));
  const pos = panelPosition(x1, y1, x2, y2, proj);

  g.save();
  drawRoundedRect(g, pos.x, pos.y, PANEL_W, PANEL_H, 3);
  g.fillStyle = "rgba(70, 70, 70, 0.92)";
  g.fill();

  g.font = canvasFont(12, { weight: 600 });
  g.fillStyle = "#f0f3fa";
  g.textBaseline = "middle";
  g.textAlign = "left";

  const rows = [
    {
      icon: "price" as const,
      text: `${fmtPriceDelta(diff)} (${pct.toFixed(2)}%), ${tickSpan.toFixed(1)}`,
    },
    {
      icon: "bars" as const,
      text: `${bars} bars (${fmtDuration(elapsed)}), distance: ${distance} px`,
    },
    {
      icon: "angle" as const,
      text: `${angle.toFixed(2)}°`,
    },
  ];

  rows.forEach((row, index) => {
    const rowY = pos.y + PANEL_PAD + index * ROW_H;
    drawInfoIcon(g, row.icon, pos.x + 12, rowY - 2);
    g.fillText(row.text, pos.x + 40, rowY + 10);
  });
  g.restore();
}

const plugin: DrawingToolPlugin = {
  tool: "infoLine",
  minPoints: 2,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    line(g, x1, y1, x2, y2);
    if (d.id !== "__pending") renderInfoPanel(g, d, proj, x1, y1, x2, y2);
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const segDist = distToSegment(px, py, x1, y1, x2, y2);
    if (segDist < TOL)
      results.push({ drawing: d, target: "body", distance: segDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2) - 12,
      y: Math.min(y1, y2) - PANEL_H - 28,
      w: Math.abs(x2 - x1) + PANEL_W + 36,
      h: Math.abs(y2 - y1) + PANEL_H + 56,
    };
  },
};

registerTool(plugin);
