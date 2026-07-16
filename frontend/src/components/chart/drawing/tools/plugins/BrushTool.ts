/**
 * BrushTool — renders and hit-tests freehand strokes.
 *
 * TradingView treats Highlighter as the same pointer-drag workflow as Brush,
 * but with a wider semi-transparent stroke so it marks zones without covering
 * candles. Keep both tools in this one adapter factory so hit-testing,
 * smoothing, selection handles, and movement stay identical.
 */
import type { Drawing, Point as Pt } from "@/types";
import type { DrawingTool } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  distToSegment,
} from "../ToolRegistry";
import { handle } from "./shared";

function project(
  pt: Pt,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
) {
  const x = toX(pt.time);
  const y = toY(pt.price);
  return x != null && y != null ? { x, y } : null;
}

const MIN_PRESSURE_SCALE = 0.35;
const PRESSURE_RANGE = 0.9;

/**
 * Map normalized pen pressure to a stable visual width. Mouse/touch points have
 * no pressure and therefore keep the configured width exactly, preserving all
 * historical strokes. The non-zero floor avoids gaps from pen-up jitter.
 */
export function pressureStrokeWidth(baseWidth: number, pressure?: number): number {
  const safeBase = Math.max(0.5, Number.isFinite(baseWidth) ? baseWidth : 1.5);
  if (!Number.isFinite(pressure)) return safeBase;
  const normalized = Math.max(0, Math.min(1, Number(pressure)));
  return safeBase * (MIN_PRESSURE_SCALE + normalized * PRESSURE_RANGE);
}

export function pressureSegmentWidths(
  points: readonly Pt[],
  baseWidth: number,
): number[] {
  const widths: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = pressureStrokeWidth(baseWidth, points[index]?.pressure);
    const b = pressureStrokeWidth(baseWidth, points[index + 1]?.pressure);
    widths.push((a + b) / 2);
  }
  return widths;
}

function makeBrushTool(
  tool: Extract<DrawingTool, "brush" | "highlighter">,
): DrawingToolPlugin {
  const highlighter = tool === "highlighter";
  return {
    tool,
    minPoints: 2,
    continuous: true,
    render(
      g: CanvasRenderingContext2D,
      d: Drawing,
      proj: Projector,
      selected: boolean,
    ) {
      const pts = d.points;
      if (pts.length < 2) return;
      g.save();
      const baseWidth = highlighter
        ? Math.max(d.lineWidth || 8, 8)
        : Math.max(d.lineWidth || 1.5, 0.5);
      if (highlighter) {
        g.globalAlpha = d.opacity ?? 0.35;
        g.lineWidth = baseWidth;
        g.lineCap = "round";
        g.lineJoin = "round";
      } else {
        g.lineCap = "round";
        g.lineJoin = "round";
      }
      g.beginPath();
      const p0 = project(pts[0], proj.toX, proj.toY);
      if (!p0) {
        g.restore();
        return;
      }
      const last = project(pts[pts.length - 1], proj.toX, proj.toY);
      const pressureAware = pts.some((point) => Number.isFinite(point.pressure));
      if (pressureAware) {
        // Pointer-continuous points are already sampled at a <=2px cadence.
        // Stroking each short segment with round caps yields a smooth envelope
        // while allowing Canvas2D's otherwise path-wide lineWidth to vary.
        const widths = pressureSegmentWidths(pts, baseWidth);
        for (let index = 0; index < pts.length - 1; index += 1) {
          const a = project(pts[index], proj.toX, proj.toY);
          const b = project(pts[index + 1], proj.toX, proj.toY);
          if (!a || !b) continue;
          g.lineWidth = widths[index];
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
          g.stroke();
        }
      } else {
        g.lineWidth = baseWidth;
        g.beginPath();
        g.moveTo(p0.x, p0.y);
        for (let i = 1; i < pts.length - 1; i++) {
          const a = project(pts[i], proj.toX, proj.toY);
          const b = project(pts[i + 1], proj.toX, proj.toY);
          if (!a || !b) continue;
          g.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        if (last) g.lineTo(last.x, last.y);
        g.stroke();
      }
      g.restore();
      if (selected && last) {
        handle(g, p0.x, p0.y, d.color);
        handle(g, last.x, last.y, d.color);
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
      const projected = d.points.map((pt) => ({
        x: toX(pt.time),
        y: toY(pt.price),
      }));
      const baseWidth = highlighter
        ? Math.max(d.lineWidth || 8, 8)
        : Math.max(d.lineWidth || 1.5, 0.5);
      const segmentWidths = pressureSegmentWidths(d.points, baseWidth);
      const first = projected[0];
      const last = projected[projected.length - 1];
      if (first?.x != null && first.y != null) {
        const distance = Math.hypot(px - first.x, py - first.y);
        if (distance <= HANDLE_RADIUS) {
          results.push({ drawing: d, target: "p1", anchorIndex: 0, distance });
        }
      }
      if (last?.x != null && last.y != null) {
        const distance = Math.hypot(px - last.x, py - last.y);
        if (distance <= HANDLE_RADIUS) {
          results.push({
            drawing: d,
            target: "p2",
            anchorIndex: projected.length - 1,
            distance,
          });
        }
      }
      for (let j = 0; j < projected.length - 1; j++) {
        const a = projected[j],
          b = projected[j + 1];
        if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
        const segDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
        const tolerance = Math.max(TOL, (segmentWidths[j] ?? baseWidth) / 2 + 3);
        if (segDist < tolerance)
          results.push({ drawing: d, target: "body", distance: segDist });
      }
      return results;
    },
    getAnchors(d, toX, toY) {
      if (d.points.length === 0) return [];
      const first = project(d.points[0], toX, toY);
      const lastIndex = d.points.length - 1;
      if (lastIndex === 0) {
        return [{
          index: 0,
          x: first?.x ?? null,
          y: first?.y ?? null,
          target: "p1" as const,
        }];
      }
      const last = project(d.points[lastIndex], toX, toY);
      return [
        {
          index: 0,
          x: first?.x ?? null,
          y: first?.y ?? null,
          target: "p1" as const,
        },
        {
          index: lastIndex,
          x: last?.x ?? null,
          y: last?.y ?? null,
          target: "p2" as const,
        },
      ];
    },
    movePoints: defaultMovePoints,
    boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
      const xs = d.points
        .map((pt) => toX(pt.time))
        .filter((v): v is number => v != null);
      const ys = d.points
        .map((pt) => toY(pt.price))
        .filter((v): v is number => v != null);
      if (xs.length === 0 || ys.length === 0) return null;
      const baseWidth = highlighter
        ? Math.max(d.lineWidth || 8, 8)
        : Math.max(d.lineWidth || 1.5, 0.5);
      const strokeRadius = Math.max(
        TOL,
        ...d.points.map((point) => pressureStrokeWidth(baseWidth, point.pressure) / 2 + 3),
      );
      return {
        x: Math.min(...xs) - strokeRadius,
        y: Math.min(...ys) - strokeRadius,
        w: Math.max(...xs) - Math.min(...xs) + strokeRadius * 2,
        h: Math.max(...ys) - Math.min(...ys) + strokeRadius * 2,
      };
    },
  };
}

registerTool(makeBrushTool("brush"));
registerTool(makeBrushTool("highlighter"));
