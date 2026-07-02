/**
 * FibRetracementTool - TradingView-style Fibonacci retracement.
 *
 * Two anchors define the source trend line. Internal levels live between 0 and
 * 1; external retracement levels (> 1) remain tied to the same two anchors.
 */
import type { Drawing } from "@/types";
import { FIB_LEVELS } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToRect,
  distToSegment,
} from "../ToolRegistry";
import { canvasFont, line, handle } from "./shared";

const LEVEL_OPACITY = 0.74;
const FILL_OPACITY = 0.075;
const LABEL_PAD = 6;
const LABEL_CULL_PAD = 130;

function priceDecimals(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 1000) return 2;
  if (abs >= 1) return 4;
  return 6;
}

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: priceDecimals(price),
    maximumFractionDigits: priceDecimals(price),
  });
}

function formatLevel(level: number): string {
  return Number.isInteger(level)
    ? String(level)
    : level.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function levelPrice(d: Drawing, level: number): number {
  return d.points[0].price + (d.points[1].price - d.points[0].price) * level;
}

function xRange(d: Drawing, x1: number, x2: number, width: number) {
  const baseLeft = Math.min(x1, x2);
  const baseRight = Math.max(x1, x2);
  const extend = d.extend ?? "none";
  return {
    left: extend === "left" || extend === "both" ? 0 : baseLeft,
    right: extend === "right" || extend === "both" ? width : baseRight,
  };
}

function labelXFor(g: CanvasRenderingContext2D, label: string, right: number, width: number) {
  const textW = g.measureText(label).width;
  return Math.max(4, Math.min(right + LABEL_PAD, width - textW - 4));
}

function projectedLevels(
  d: Drawing,
  toY: HitTestProjector,
): Array<{ level: number; price: number; y: number }> {
  const levels: Array<{ level: number; price: number; y: number }> = [];
  for (const level of FIB_LEVELS) {
    const price = levelPrice(d, level);
    const y = toY(price);
    if (y != null) levels.push({ level, price, y });
  }
  return levels;
}

const plugin: DrawingToolPlugin = {
  tool: "fibRetracement",
  minPoints: 2,

  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    if (d.points.length < 2) return;
    const x1 = proj.toX(d.points[0].time);
    const y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time);
    const y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;

    const { left, right } = xRange(d, x1, x2, proj.width);
    const levels = projectedLevels(d, proj.toY);

    g.save();

    // Background bands between adjacent Fibonacci levels.
    if (levels.length > 1 && d.opacity !== 0) {
      const sorted = [...levels].sort((a, b) => a.y - b.y);
      g.fillStyle = d.fillColor && d.fillColor !== "none" ? d.fillColor : d.color;
      for (let i = 0; i < sorted.length - 1; i++) {
        const top = sorted[i].y;
        const bottom = sorted[i + 1].y;
        g.globalAlpha = (d.opacity ?? 1) * FILL_OPACITY * (i % 2 === 0 ? 1 : 0.62);
        g.fillRect(left, top, right - left, Math.max(1, bottom - top));
      }
    }

    // Source trend line.
    g.globalAlpha = 0.56;
    g.setLineDash([5, 4]);
    g.lineWidth = Math.max(1, d.lineWidth || 1.5);
    line(g, x1, y1, x2, y2);
    g.setLineDash([]);

    // Level lines and right-side labels.
    g.font = canvasFont(11, { weight: 500 });
    g.textBaseline = "middle";
    for (const { level, price, y } of levels) {
      g.globalAlpha = LEVEL_OPACITY;
      line(g, left, y, right, y);
      const label = `${formatLevel(level)}  ${formatPrice(price)}`;
      g.globalAlpha = 1;
      g.fillStyle = d.color;
      g.fillText(label, labelXFor(g, label, right, proj.width), y - 1);
    }
    g.restore();

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
    if (d.points.length < 2) return results;
    const x1 = toX(d.points[0].time);
    const y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time);
    const y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;

    const p1Dist = pointDist(px, py, x1, y1);
    const p2Dist = pointDist(px, py, x2, y2);
    if (p1Dist <= HANDLE_RADIUS) {
      results.push({ drawing: d, target: "p1", anchorIndex: 0, distance: p1Dist });
    }
    if (p2Dist <= HANDLE_RADIUS) {
      results.push({ drawing: d, target: "p2", anchorIndex: 1, distance: p2Dist });
    }

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    for (const { y } of projectedLevels(d, toY)) {
      const dist = distToSegment(px, py, left, y, right, y);
      if (dist < TOL) results.push({ drawing: d, target: "body", distance: dist });
    }

    const trendDist = distToSegment(px, py, x1, y1, x2, y2);
    if (trendDist < TOL) {
      results.push({ drawing: d, target: "body", distance: trendDist });
    }

    const ys = projectedLevels(d, toY).map((l) => l.y);
    if (ys.length > 0) {
      const bodyDist = distToRect(px, py, left, Math.min(...ys), right, Math.max(...ys));
      if (bodyDist < TOL) results.push({ drawing: d, target: "body", distance: bodyDist + 0.5 });
    }

    return results;
  },

  movePoints: defaultMovePoints,

  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    if (d.points.length < 2) return null;
    const x1 = toX(d.points[0].time);
    const x2 = toX(d.points[1].time);
    if (x1 == null || x2 == null) return null;
    const ys = projectedLevels(d, toY).map((l) => l.y);
    if (ys.length === 0) return null;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    return {
      x: left,
      y: Math.min(...ys),
      w: right - left + LABEL_CULL_PAD,
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
};

registerTool(plugin);
