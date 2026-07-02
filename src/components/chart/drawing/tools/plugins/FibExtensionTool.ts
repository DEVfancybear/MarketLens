/**
 * FibExtensionTool - TradingView-style trend-based Fibonacci extension.
 *
 * New drawings use three clicks:
 *   A -> B defines the impulse length.
 *   C defines the projection origin after the pullback.
 * Level price = C + ratio * (B - A).
 *
 * Existing two-point objects are still rendered by treating B as C.
 */
import type { Drawing } from "@/types";
import { FIB_EXT_LEVELS } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type Anchor,
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
const FILL_OPACITY = 0.07;
const LABEL_PAD = 6;
const LABEL_CULL_PAD = 150;

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

function projectionOrigin(d: Drawing) {
  return d.points[2] ?? d.points[1];
}

function levelPrice(d: Drawing, level: number): number {
  const a = d.points[0];
  const b = d.points[1];
  const c = projectionOrigin(d);
  return c.price + (b.price - a.price) * level;
}

function projectedLevels(
  d: Drawing,
  toY: HitTestProjector,
): Array<{ level: number; price: number; y: number }> {
  const levels: Array<{ level: number; price: number; y: number }> = [];
  for (const level of FIB_EXT_LEVELS) {
    const price = levelPrice(d, level);
    const y = toY(price);
    if (y != null) levels.push({ level, price, y });
  }
  return levels;
}

function labelXFor(g: CanvasRenderingContext2D, label: string, right: number, width: number) {
  const textW = g.measureText(label).width;
  return Math.max(4, Math.min(right + LABEL_PAD, width - textW - 4));
}

const plugin: DrawingToolPlugin = {
  tool: "fibExtension",
  minPoints: 2,
  maxPoints: 3,

  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    if (d.points.length < 2) return;
    const a = d.points[0];
    const b = d.points[1];
    const c = projectionOrigin(d);
    const x1 = proj.toX(a.time);
    const y1 = proj.toY(a.price);
    const x2 = proj.toX(b.time);
    const y2 = proj.toY(b.price);
    const x3 = proj.toX(c.time);
    const y3 = proj.toY(c.price);
    if (x1 == null || y1 == null || x2 == null || y2 == null || x3 == null || y3 == null) {
      return;
    }

    const left = Math.max(0, Math.min(x3, proj.width));
    const right = proj.width;
    const levels = projectedLevels(d, proj.toY);

    g.save();

    if (levels.length > 1 && d.opacity !== 0) {
      const sorted = [...levels].sort((m, n) => m.y - n.y);
      g.fillStyle = d.fillColor && d.fillColor !== "none" ? d.fillColor : d.color;
      for (let i = 0; i < sorted.length - 1; i++) {
        const top = sorted[i].y;
        const bottom = sorted[i + 1].y;
        g.globalAlpha = (d.opacity ?? 1) * FILL_OPACITY * (i % 2 === 0 ? 1 : 0.6);
        g.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
      }
    }

    // A-B impulse guide and B-C pullback/projection-origin guide.
    g.globalAlpha = 0.58;
    g.setLineDash([5, 4]);
    g.lineWidth = Math.max(1, d.lineWidth || 1.5);
    line(g, x1, y1, x2, y2);
    if (d.points[2]) line(g, x2, y2, x3, y3);
    g.setLineDash([]);

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
      if (d.points[2]) handle(g, x3, y3, d.color);
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
    const projected = d.points.slice(0, 3).map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));

    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];
      if (p.x == null || p.y == null) continue;
      const dist = pointDist(px, py, p.x, p.y);
      if (dist <= HANDLE_RADIUS) {
        results.push({
          drawing: d,
          target: i === 0 ? "p1" : i === 1 ? "p2" : "p3",
          anchorIndex: i,
          distance: dist,
        });
      }
    }

    const a = projected[0];
    const b = projected[1];
    const c = projected[2] ?? projected[1];
    if (a.x == null || a.y == null || b.x == null || b.y == null || c.x == null || c.y == null) {
      return results;
    }

    const impulseDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
    if (impulseDist < TOL) {
      results.push({ drawing: d, target: "body", distance: impulseDist });
    }
    if (d.points[2]) {
      const originDist = distToSegment(px, py, b.x, b.y, c.x, c.y);
      if (originDist < TOL) {
        results.push({ drawing: d, target: "body", distance: originDist });
      }
    }

    const left = c.x;
    const right = Math.max(c.x, c.x + 9999);
    const levels = projectedLevels(d, toY);
    for (const { y } of levels) {
      const dist = distToSegment(px, py, left, y, right, y);
      if (dist < TOL) results.push({ drawing: d, target: "body", distance: dist });
    }
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
    const xs = d.points
      .slice(0, 3)
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = projectedLevels(d, toY).map((l) => l.y);
    if (xs.length === 0 || ys.length === 0) return null;
    const left = Math.min(...xs);
    return {
      x: left,
      y: Math.min(...ys),
      w: 9999 + LABEL_CULL_PAD,
      h: Math.max(...ys) - Math.min(...ys),
    };
  },

  getAnchors(d: Drawing, toX: HitTestProjector, toY: HitTestProjector): Anchor[] {
    return d.points.slice(0, 3).map((pt, i) => ({
      index: i,
      x: toX(pt.time),
      y: toY(pt.price),
      target: i === 0 ? "p1" : i === 1 ? "p2" : "p3",
    }));
  },
};

registerTool(plugin);
