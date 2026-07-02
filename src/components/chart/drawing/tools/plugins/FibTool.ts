/**
 * Legacy `fib` tool kept for saved drawings and old hot paths.
 * It mirrors the modern fibRetracement renderer/hit-test contract.
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

const FILL_OPACITY = 0.07;
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
  tool: "fib",
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

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const levels = projectedLevels(d, proj.toY);

    g.save();
    if (levels.length > 1) {
      const sorted = [...levels].sort((a, b) => a.y - b.y);
      g.fillStyle = d.fillColor && d.fillColor !== "none" ? d.fillColor : d.color;
      for (let i = 0; i < sorted.length - 1; i++) {
        const top = sorted[i].y;
        const bottom = sorted[i + 1].y;
        g.globalAlpha = FILL_OPACITY * (i % 2 === 0 ? 1 : 0.62);
        g.fillRect(left, top, right - left, Math.max(1, bottom - top));
      }
    }

    g.globalAlpha = 0.56;
    g.setLineDash([5, 4]);
    line(g, x1, y1, x2, y2);
    g.setLineDash([]);
    g.font = canvasFont(11, { weight: 500 });
    g.textBaseline = "middle";
    for (const { level, price, y } of levels) {
      g.globalAlpha = 0.74;
      line(g, left, y, right, y);
      g.globalAlpha = 1;
      g.fillStyle = d.color;
      g.fillText(`${formatLevel(level)}  ${formatPrice(price)}`, right + 6, y - 1);
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
    const levels = projectedLevels(d, toY);
    for (const { y } of levels) {
      const dist = distToSegment(px, py, left, y, right, y);
      if (dist < TOL) results.push({ drawing: d, target: "body", distance: dist });
    }
    const trendDist = distToSegment(px, py, x1, y1, x2, y2);
    if (trendDist < TOL) results.push({ drawing: d, target: "body", distance: trendDist });
    if (levels.length > 0) {
      const ys = levels.map((l) => l.y);
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
