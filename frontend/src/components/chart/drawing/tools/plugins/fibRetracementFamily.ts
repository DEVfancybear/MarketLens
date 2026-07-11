import type { Drawing, DrawingTool } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  distToRect,
  distToSegment,
  pointDist,
} from "../ToolRegistry";
import { applyStyle, canvasFont, handle, line } from "./shared";
import {
  fibLabelBaseline,
  fibLabelText,
  fibLabelX,
  projectFibLevels,
  retracementXRange,
  usableFibRight,
  visibleFibLabels,
} from "./fibGeometry";

const LEVEL_OPACITY = 0.82;
const FILL_OPACITY = 0.12;
const DEFAULT_TREND_LINE_COLOR = "#787b86";

export function createFibRetracementPlugin(
  tool: Extract<DrawingTool, "fib" | "fibRetracement">,
): DrawingToolPlugin {
  return {
    tool,
    minPoints: 2,
    render(g, drawing, projector, selected) {
      renderFibRetracement(g, drawing, projector, selected);
    },
    hitTest: hitTestFibRetracement,
    movePoints: defaultMovePoints,
    boundingBox: fibRetracementBounds,
  };
}

export function renderFibRetracement(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  projector: Projector,
  selected: boolean,
) {
  if (drawing.points.length < 2) return;
  const x1 = projector.toX(drawing.points[0].time);
  const y1 = projector.toY(drawing.points[0].price);
  const x2 = projector.toX(drawing.points[1].time);
  const y2 = projector.toY(drawing.points[1].price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;

  const usableRight = usableFibRight(projector.width);
  const { left, right } = retracementXRange(
    drawing,
    x1,
    x2,
    projector.width,
  );
  const levels = projectFibLevels(drawing, projector.toY, "retracement");
  const fontSize = drawing.fontSize ?? 12;
  const labels = new Set(
    visibleFibLabels(levels, projector.height, fontSize),
  );

  g.save();
  g.beginPath();
  g.rect(0, 0, usableRight, projector.height);
  g.clip();
  if (levels.length > 1 && drawing.fibBackground !== false && drawing.opacity !== 0) {
    const sorted = [...levels].sort((a, b) => a.y - b.y);
    for (let index = 0; index < sorted.length - 1; index++) {
      const top = sorted[index].y;
      const bottom = sorted[index + 1].y;
      g.fillStyle = sorted[index].color;
      g.globalAlpha =
        (drawing.opacity ?? FILL_OPACITY) * (index % 2 === 0 ? 1 : 0.62);
      g.fillRect(left, top, right - left, Math.max(1, bottom - top));
    }
  }

  if (drawing.fibTrendLine !== false) {
    g.globalAlpha = 0.68;
    g.strokeStyle = drawing.fibTrendLineColor || DEFAULT_TREND_LINE_COLOR;
    g.lineWidth = Math.max(1, drawing.fibTrendLineWidth ?? drawing.lineWidth ?? 1.5);
    applyStyle(g, drawing.fibTrendLineStyle ?? "dashed");
    line(g, x1, y1, x2, y2);
    g.setLineDash([]);
  }

  g.font = canvasFont(fontSize, { weight: 500 });
  g.textBaseline = fibLabelBaseline(drawing.fibLabelsVAlign ?? "middle");
  g.textAlign = "left";
  for (const projected of levels) {
    const { level, price, y, color } = projected;
    g.strokeStyle = drawing.fibUseOneColor
      ? drawing.fibLevelLineColor || drawing.color
      : color;
    g.lineWidth = Math.max(1, drawing.fibLevelLineWidth ?? drawing.lineWidth ?? 1.5);
    applyStyle(g, drawing.fibLevelLineStyle ?? drawing.lineStyle ?? "solid");
    if (drawing.fibLevelsLine !== false) {
      g.globalAlpha = LEVEL_OPACITY;
      line(g, left, y, right, y);
    }
    if (!labels.has(projected)) continue;
    const label = fibLabelText(drawing, level, price);
    if (!label) continue;
    g.globalAlpha = 1;
    g.fillStyle = drawing.fibUseOneColor
      ? drawing.fibLevelLineColor || drawing.color
      : color;
    g.fillText(
      label,
      fibLabelX(
        g.measureText(label).width,
        left,
        right,
        usableRight,
        drawing.fibLabelsHAlign ?? "left",
      ),
      y,
    );
  }
  g.restore();

  if (selected) {
    handle(g, x1, y1, drawing.color);
    handle(g, x2, y2, drawing.color);
  }
}

export function hitTestFibRetracement(
  drawing: Drawing,
  px: number,
  py: number,
  toX: HitTestProjector,
  toY: HitTestProjector,
): HitResult[] {
  if (drawing.points.length < 2) return [];
  const x1 = toX(drawing.points[0].time);
  const y1 = toY(drawing.points[0].price);
  const x2 = toX(drawing.points[1].time);
  const y2 = toY(drawing.points[1].price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return [];
  const results: HitResult[] = [];
  const p1Distance = pointDist(px, py, x1, y1);
  const p2Distance = pointDist(px, py, x2, y2);
  if (p1Distance <= HANDLE_RADIUS) {
    results.push({ drawing, target: "p1", anchorIndex: 0, distance: p1Distance });
  }
  if (p2Distance <= HANDLE_RADIUS) {
    results.push({ drawing, target: "p2", anchorIndex: 1, distance: p2Distance });
  }
  const { left, right } = retracementXRange(drawing, x1, x2);
  const levels = projectFibLevels(drawing, toY, "retracement");
  for (const { y } of levels) {
    const distance = distToSegment(px, py, left, y, right, y);
    if (distance < TOL) results.push({ drawing, target: "body", distance });
  }
  const trendDistance = distToSegment(px, py, x1, y1, x2, y2);
  if (trendDistance < TOL) {
    results.push({ drawing, target: "body", distance: trendDistance });
  }
  if (levels.length > 0) {
    const ys = levels.map((level) => level.y);
    const distance = distToRect(px, py, left, Math.min(...ys), right, Math.max(...ys));
    if (distance < TOL) {
      results.push({ drawing, target: "body", distance: distance + 0.5 });
    }
  }
  return results;
}

export function fibRetracementBounds(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
) {
  if (drawing.points.length < 2) return null;
  const x1 = toX(drawing.points[0].time);
  const x2 = toX(drawing.points[1].time);
  if (x1 == null || x2 == null) return null;
  const ys = projectFibLevels(drawing, toY, "retracement").map((level) => level.y);
  if (ys.length === 0) return null;
  const { left, right } = retracementXRange(drawing, x1, x2);
  return {
    x: left - TOL,
    y: Math.min(...ys) - TOL,
    w: right - left + TOL * 2,
    h: Math.max(...ys) - Math.min(...ys) + TOL * 2,
  };
}
