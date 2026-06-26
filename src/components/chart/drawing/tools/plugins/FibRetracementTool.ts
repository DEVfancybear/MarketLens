/**
 * FibRetracementTool — Fibonacci retracement drawing tool.
 *
 * Draw from high→low (or low→high) to anchor retracement levels.
 * Levels render at standard ratios (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1)
 * as horizontal lines with percentage labels on the right side.
 *
 * Two anchor points:
 *   p1 — start (typically the trend high)
 *   p2 — end   (typically the trend low)
 * Levels span the full x-range between the two anchors.
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
} from "../ToolRegistry";
import { line, handle } from "./shared";

const LEVEL_OPACITY = 0.7;

const plugin: DrawingToolPlugin = {
  tool: "fibRetracement",
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

    const hi = pts[0].price;
    const lo = pts[1].price;
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);

    // Draw the anchor trend line (high to low).
    g.save();
    g.globalAlpha = 0.5;
    g.setLineDash([4, 4]);
    g.lineWidth = 1;
    line(g, x1, y1, x2, y2);
    g.setLineDash([]);
    g.globalAlpha = 1;

    // Draw retracement levels.
    g.font = "10px var(--font-mono)";
    for (const lvl of FIB_LEVELS) {
      const price = hi + (lo - hi) * lvl;
      const y = proj.toY(price);
      if (y == null) continue;

      g.globalAlpha = LEVEL_OPACITY;
      line(g, left, y, right, y);
      g.globalAlpha = 1;

      // Label: percentage + price.
      const pct = (lvl * 100).toFixed(1);
      const label = lvl === 0
        ? `${pct}%  ${price.toFixed(4)}`
        : `${pct}%  ${price.toFixed(4)}`;
      g.fillStyle = d.color;
      g.fillText(label, right + 4, y + 3);
    }
    g.restore();

    // Selection handles at both anchors.
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

    // Hit the body region (the rectangle spanning both anchors).
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
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  },
};

registerTool(plugin);
