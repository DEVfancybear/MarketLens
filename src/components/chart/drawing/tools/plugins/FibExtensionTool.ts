/**
 * FibExtensionTool — Fibonacci extension / expansion drawing tool.
 *
 * Two anchor points define the impulse move (A→B). Extension levels are
 * projected beyond B in the direction of A→B using the A→B distance as
 * the base unit.
 *
 * Levels: -0.272, -0.618, 0, 0.618, 1, 1.272, 1.382, 1.618, 2, 2.618
 *
 *   p1 (A) — trend start / impulse origin
 *   p2 (B) — impulse end / projection origin
 *
 * Level price = B_price + ratio * (B_price - A_price)
 *
 * Negative levels project in the opposite direction (before A).
 * Positive levels project beyond B.
 */
import type { Drawing } from "@/types";
import { FIB_EXT_LEVELS } from "@/types";
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
} from "../ToolRegistry";
import { line, handle } from "./shared";

const LEVEL_OPACITY = 0.7;

const plugin: DrawingToolPlugin = {
  tool: "fibExtension",
  minPoints: 2,

  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const pts = d.points;
    const x1 = proj.toX(pts[0].time);
    const y1 = proj.toY(pts[0].price);
    const x2 = proj.toX(pts[1].time);
    const y2 = proj.toY(pts[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;

    // A→B impulse vector: B_price - A_price.
    const aPrice = pts[0].price;
    const bPrice = pts[1].price;
    const impulse = bPrice - aPrice;

    // X-range: extend a bit past B so extension labels don't clip.
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const extRight = right + 20; // extra padding for labels on rightmost side

    // Draw the anchor trend line (A→B) as a dashed guide.
    g.save();
    g.globalAlpha = 0.5;
    g.setLineDash([4, 4]);
    g.lineWidth = 1;
    line(g, x1, y1, x2, y2);
    g.setLineDash([]);
    g.globalAlpha = 1;

    // Draw extension levels.
    g.font = "10px var(--font-mono)";
    for (const lvl of FIB_EXT_LEVELS) {
      // Project level from B: B + ratio * (B - A)
      const price = bPrice + lvl * impulse;
      const y = proj.toY(price);
      if (y == null) continue;

      g.globalAlpha = LEVEL_OPACITY;
      line(g, left, y, extRight, y);
      g.globalAlpha = 1;

      // Label: ratio + price.
      const pct = (lvl * 100).toFixed(1);
      g.fillStyle = d.color;
      g.fillText(`${pct}%  ${price.toFixed(4)}`, extRight + 4, y + 3);
    }
    g.restore();

    // Selection handles.
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
    const x1 = toX(d.points[0].time);
    const y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time);
    const y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;

    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS) {
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    }
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS) {
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    }

    const bodyDist = distToRect(px, py, x1, y1, x2, y2);
    if (bodyDist < TOL) {
      results.push({ drawing: d, target: "body", distance: bodyDist });
    }

    return results;
  },

  movePoints: defaultMovePoints,

  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x1 = toX(d.points[0].time);
    const y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time);
    const y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    // Extend the bounding box vertically to cover extended levels.
    const aPrice = d.points[0].price;
    const bPrice = d.points[1].price;
    const impulse = bPrice - aPrice;
    const yMin = Math.min(y1, y2, toY(bPrice + Math.max(...FIB_EXT_LEVELS) * impulse) ?? Infinity);
    const yMax = Math.max(y1, y2, toY(bPrice + Math.min(...FIB_EXT_LEVELS) * impulse) ?? -Infinity);
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  },
};

registerTool(plugin);
