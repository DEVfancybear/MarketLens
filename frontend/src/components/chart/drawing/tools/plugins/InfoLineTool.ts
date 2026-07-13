/**
 * InfoLineTool - TradingView-style measurement line with a multi-row stats panel.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line, handle, angleDeg, canvasFont } from "./shared";
import {
  finiteSegmentBodyHits,
  projectTwoPoints,
  twoPointAnchorHits,
  twoPointAnchors,
} from "./lineGeometry";

const PANEL_MIN_W = 246;
const PANEL_H = 92;
const PANEL_PAD = 12;
const PANEL_ROW_H = 28;
const PANEL_TEXT_X = 40;
const PANEL_RIGHT_PAD = 14;
const PANEL_CULL_W = 360;
// Reserve the right price scale / current-price label strip. The drawing canvas
// spans the full chart container, so panels must be clipped before this zone.
const RIGHT_PRICE_SCALE_GUARD = 112;
const PANEL_EDGE_PAD = 6;
const PANEL_ANCHOR_GAP = 16;

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
  panelWidth: number,
): { x: number; y: number } {
  const usableRight = usablePanelRight(proj);
  const midX = (x1 + x2) / 2;
  const lineLeft = Math.min(x1, x2);
  const lineRight = Math.max(x1, x2);
  const rightOfLine = lineRight + PANEL_ANCHOR_GAP;
  const leftOfLine = lineLeft - panelWidth - PANEL_ANCHOR_GAP;
  const below = Math.max(y1, y2) + 16;
  const above = Math.min(y1, y2) - PANEL_H - 16;
  const preferredY = below + PANEL_H <= proj.height - 6 ? below : above;
  const centered = midX - panelWidth / 2;
  const preferredX =
    rightOfLine + panelWidth <= usableRight - PANEL_EDGE_PAD
      ? rightOfLine
      : leftOfLine >= PANEL_EDGE_PAD
        ? leftOfLine
        : centered;
  return {
    x: clamp(
      preferredX,
      PANEL_EDGE_PAD,
      Math.max(PANEL_EDGE_PAD, usableRight - panelWidth - PANEL_EDGE_PAD),
    ),
    y: clamp(
      preferredY,
      PANEL_EDGE_PAD,
      Math.max(PANEL_EDGE_PAD, proj.height - PANEL_H - PANEL_EDGE_PAD),
    ),
  };
}

function usablePanelRight(proj: Projector): number {
  return Math.max(96, proj.width - RIGHT_PRICE_SCALE_GUARD);
}

function fitText(
  g: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string {
  if (g.measureText(text).width <= maxWidth) return text;

  const ellipsis = "...";
  if (g.measureText(ellipsis).width > maxWidth) return "";

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (g.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return text.slice(0, lo) + ellipsis;
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
  const tfSeconds = Math.max(1, proj.barIntervalSeconds ?? 60);
  const elapsed = Math.abs(d.points[1].time - d.points[0].time);
  const bars = Math.max(1, Math.round(elapsed / tfSeconds));
  const angle = Math.abs(angleDeg(x1, y1, x2, y2));
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
      text: `${angle.toFixed(2)}\u00B0`,
    },
  ];

  g.save();
  g.font = canvasFont(12, { weight: 600 });
  const measuredTextWidth = Math.max(
    ...rows.map((row) => g.measureText(row.text).width),
  );
  const usableRight = usablePanelRight(proj);
  const maxPanelWidth = Math.max(80, usableRight - PANEL_EDGE_PAD * 2);
  const panelWidth = Math.min(
    maxPanelWidth,
    Math.max(
      Math.min(PANEL_MIN_W, maxPanelWidth),
      Math.ceil(measuredTextWidth + PANEL_TEXT_X + PANEL_RIGHT_PAD),
    ),
  );
  const availableTextWidth = Math.max(
    0,
    panelWidth - PANEL_TEXT_X - PANEL_RIGHT_PAD,
  );
  const pos = panelPosition(x1, y1, x2, y2, proj, panelWidth);

  g.beginPath();
  g.rect(0, 0, usableRight, proj.height);
  g.clip();

  drawRoundedRect(g, pos.x, pos.y, panelWidth, PANEL_H, 3);
  g.fillStyle = "rgba(70, 70, 70, 0.92)";
  g.fill();

  g.fillStyle = "#f0f3fa";
  g.textBaseline = "middle";
  g.textAlign = "left";

  rows.forEach((row, index) => {
    const rowY = pos.y + PANEL_PAD + index * PANEL_ROW_H;
    drawInfoIcon(g, row.icon, pos.x + 12, rowY - 2);
    g.fillText(
      fitText(g, row.text, availableTextWidth),
      pos.x + PANEL_TEXT_X,
      rowY + 10,
    );
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
    const segment = projectTwoPoints(d, toX, toY);
    return [
      ...twoPointAnchorHits(d, segment, px, py),
      ...finiteSegmentBodyHits(d, segment, px, py),
    ];
  },
  getAnchors: twoPointAnchors,
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
      w: Math.abs(x2 - x1) + PANEL_CULL_W + 24,
      h: Math.abs(y2 - y1) + PANEL_H + 56,
    };
  },
};

registerTool(plugin);
