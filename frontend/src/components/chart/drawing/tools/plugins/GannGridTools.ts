/** TradingView-style Gann Square and Gann Box, backed by shared primitives. */
import type {
  Drawing,
  DrawingTool,
  GannBoxConfig,
  GannSquareConfig,
} from "../../../../../types";
import { resolveGannConfig } from "../../../../../types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import {
  TOL,
  defaultMovePoints,
  distToSegment,
  registerTool,
  type DrawingToolPlugin,
} from "../ToolRegistry";
import { applyStyle, canvasFont, handle, line } from "./shared";
import { twoPointAnchorHits, type Segment } from "./lineGeometry";
import {
  gannLogicalBars,
  projectGannGrid,
  type GannArc,
  type GannGridGeometry,
  type GannStroke,
} from "./gannGeometry";

type GridFamily = "square" | "box";

function strokeColor(
  drawing: Drawing,
  config: GannSquareConfig | GannBoxConfig,
  stroke: GannStroke | GannArc,
): string {
  return config.useOneColor ? drawing.color : stroke.color ?? drawing.color;
}

function applyStroke(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  config: GannSquareConfig | GannBoxConfig,
  stroke: GannStroke | GannArc,
): void {
  g.strokeStyle = strokeColor(drawing, config, stroke);
  g.fillStyle = g.strokeStyle;
  g.globalAlpha = stroke.opacity ?? 1;
  g.lineWidth = stroke.lineWidth ?? drawing.lineWidth;
  applyStyle(g, stroke.lineStyle ?? drawing.lineStyle ?? "solid");
}

function drawStroke(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  config: GannSquareConfig | GannBoxConfig,
  stroke: GannStroke,
): void {
  applyStroke(g, drawing, config, stroke);
  line(
    g,
    stroke.segment.a.x,
    stroke.segment.a.y,
    stroke.segment.b.x,
    stroke.segment.b.y,
  );
}

function drawArc(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  config: GannSquareConfig,
  arc: GannArc,
): void {
  if (arc.points.length < 2) return;
  applyStroke(g, drawing, config, arc);
  g.beginPath();
  g.moveTo(arc.points[0].x, arc.points[0].y);
  for (const point of arc.points.slice(1)) g.lineTo(point.x, point.y);
  g.stroke();
}

function fillRect(
  g: CanvasRenderingContext2D,
  geometry: GannGridGeometry,
  color: string,
  opacity: number,
): void {
  g.globalAlpha = opacity;
  g.fillStyle = color;
  g.fillRect(
    geometry.left,
    geometry.top,
    geometry.right - geometry.left,
    geometry.bottom - geometry.top,
  );
}

function fillBands(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  config: GannBoxConfig,
  geometry: GannGridGeometry,
  axis: "price" | "time",
): void {
  const lines = axis === "price" ? geometry.priceLines : geometry.timeLines;
  const positions = [
    axis === "price" ? geometry.top : geometry.left,
    ...lines.map((item) => axis === "price" ? item.segment.a.y : item.segment.a.x),
    axis === "price" ? geometry.bottom : geometry.right,
  ].sort((a, b) => a - b);
  const unique = positions.filter((value, index) => index === 0 || Math.abs(value - positions[index - 1]) > 0.01);
  for (let index = 0; index < unique.length - 1; index++) {
    if (index % 2 !== 0) continue;
    const start = unique[index];
    const end = unique[index + 1];
    const source = lines[Math.min(index, Math.max(0, lines.length - 1))];
    g.fillStyle = config.useOneColor ? drawing.color : source?.color ?? drawing.color;
    g.globalAlpha = (drawing.opacity ?? 0.08) * 0.55 * (source?.opacity ?? 1);
    if (axis === "price") {
      g.fillRect(geometry.left, start, geometry.right - geometry.left, end - start);
    } else {
      g.fillRect(start, geometry.top, end - start, geometry.bottom - geometry.top);
    }
  }
}

function renderBoxLabels(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  config: GannBoxConfig,
  geometry: GannGridGeometry,
): void {
  g.font = canvasFont(drawing.fontSize ?? 10, { weight: 500 });
  g.globalAlpha = 1;
  for (const item of geometry.priceLines) {
    const label = item.label ?? "";
    if (!label) continue;
    g.fillStyle = strokeColor(drawing, config, item);
    const y = item.segment.a.y - 3;
    if (config.labelLeft) g.fillText(label, geometry.left + 3, y);
    if (config.labelRight) {
      const width = g.measureText(label).width;
      g.fillText(label, geometry.right - width - 3, y);
    }
  }
  for (const item of geometry.timeLines) {
    const label = item.label ?? "";
    if (!label) continue;
    g.fillStyle = strokeColor(drawing, config, item);
    const x = item.segment.a.x + 3;
    if (config.labelTop) g.fillText(label, x, geometry.top + 12);
    if (config.labelBottom) g.fillText(label, x, geometry.bottom - 4);
  }
}

function renderSquareRanges(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  proj: Projector,
  geometry: GannGridGeometry,
): void {
  const [first, second] = drawing.points;
  if (!first || !second) return;
  const bars = gannLogicalBars(first, second, {
    candles: proj.market?.candles,
    barIntervalSeconds: proj.barIntervalSeconds,
  });
  const price = Math.abs(second.price - first.price);
  const ratio = bars > 0 ? price / bars : 0;
  const priceLabel = `Δ ${price.toLocaleString(undefined, { maximumFractionDigits: 8 })}`;
  const timeLabel = `${bars.toLocaleString(undefined, { maximumFractionDigits: 2 })} bars`;
  const ratioLabel = `${ratio.toLocaleString(undefined, { maximumFractionDigits: 8 })} / bar`;
  g.globalAlpha = 1;
  g.fillStyle = drawing.textColor ?? drawing.color;
  g.font = canvasFont(drawing.fontSize ?? 10, { weight: 500 });
  g.fillText(priceLabel, geometry.right + 5, (geometry.top + geometry.bottom) / 2);
  g.fillText(timeLabel, geometry.left, geometry.bottom + 14);
  g.fillText(ratioLabel, geometry.left, geometry.top - 5);
}

function renderGrid(
  g: CanvasRenderingContext2D,
  drawing: Drawing,
  proj: Projector,
  selected: boolean,
  family: GridFamily,
): void {
  const geometry = projectGannGrid(drawing, family, proj.toX, proj.toY);
  if (!geometry) return;
  const resolved = resolveGannConfig(drawing.gann, family);
  if (resolved.family !== family) return;
  const config = resolved as GannSquareConfig | GannBoxConfig;
  g.save();
  if (config.background && drawing.fillColor !== "transparent") {
    fillRect(g, geometry, drawing.fillColor || drawing.color, drawing.opacity ?? 0.06);
  }
  if (config.family === "box") {
    if (config.priceBackground) fillBands(g, drawing, config, geometry, "price");
    if (config.timeBackground) fillBands(g, drawing, config, geometry, "time");
  }
  g.globalAlpha = 1;
  g.strokeStyle = drawing.color;
  g.lineWidth = drawing.lineWidth;
  applyStyle(g, drawing.lineStyle ?? "solid");
  g.strokeRect(
    geometry.left,
    geometry.top,
    geometry.right - geometry.left,
    geometry.bottom - geometry.top,
  );
  const showLevels = config.family === "box" || config.showLevels;
  if (showLevels) {
    for (const item of [...geometry.priceLines, ...geometry.timeLines]) {
      drawStroke(g, drawing, config, item);
    }
  }
  const showAngles = config.family === "box" ? config.angles : config.showFan;
  if (showAngles) {
    for (const item of geometry.angleLines) drawStroke(g, drawing, config, item);
  }
  if (config.family === "square" && config.showArcs) {
    for (const arc of geometry.arcs) drawArc(g, drawing, config, arc);
  }
  if (config.family === "box") renderBoxLabels(g, drawing, config, geometry);
  if (config.family === "square" && config.showRanges) {
    renderSquareRanges(g, drawing, proj, geometry);
  }
  g.globalAlpha = 1;
  if (selected) {
    handle(g, geometry.a.x, geometry.a.y, drawing.color);
    handle(g, geometry.b.x, geometry.b.y, drawing.color);
  }
  g.restore();
}

function arcSegments(arc: GannArc): Segment[] {
  return arc.points.slice(1).map((point, index) => ({
    a: arc.points[index],
    b: point,
  }));
}

function visibleSegments(
  drawing: Drawing,
  family: GridFamily,
  geometry: GannGridGeometry,
): Segment[] {
  const config = resolveGannConfig(drawing.gann, family);
  if (config.family !== family) return [];
  const outline: Segment[] = [
    { a: { x: geometry.left, y: geometry.top }, b: { x: geometry.right, y: geometry.top } },
    { a: { x: geometry.right, y: geometry.top }, b: { x: geometry.right, y: geometry.bottom } },
    { a: { x: geometry.right, y: geometry.bottom }, b: { x: geometry.left, y: geometry.bottom } },
    { a: { x: geometry.left, y: geometry.bottom }, b: { x: geometry.left, y: geometry.top } },
  ];
  const levels = config.family === "box" || config.showLevels
    ? [...geometry.priceLines, ...geometry.timeLines].map((item) => item.segment)
    : [];
  const angles = (config.family === "box" ? config.angles : config.showFan)
    ? geometry.angleLines.map((item) => item.segment)
    : [];
  const arcs = config.family === "square" && config.showArcs
    ? geometry.arcs.flatMap(arcSegments)
    : [];
  return [...outline, ...levels, ...angles, ...arcs];
}

function createGannGrid(tool: DrawingTool, family: GridFamily): DrawingToolPlugin {
  return {
    tool,
    minPoints: 2,
    render(g, drawing, proj, selected) {
      renderGrid(g, drawing, proj, selected, family);
    },
    hitTest(drawing, px, py, toX, toY): HitResult[] {
      const geometry = projectGannGrid(drawing, family, toX, toY);
      if (!geometry) return [];
      const anchors = twoPointAnchorHits(
        drawing,
        { a: geometry.a, b: geometry.b },
        px,
        py,
      );
      const segments = visibleSegments(drawing, family, geometry);
      const distance = Math.min(
        ...segments.map((segment) => distToSegment(
          px,
          py,
          segment.a.x,
          segment.a.y,
          segment.b.x,
          segment.b.y,
        )),
      );
      return distance < TOL
        ? [...anchors, { drawing, target: "body", distance }]
        : anchors;
    },
    movePoints: defaultMovePoints,
    boundingBox(drawing, toX: HitTestProjector, toY: HitTestProjector) {
      const geometry = projectGannGrid(drawing, family, toX, toY);
      if (!geometry) return null;
      const rendered = visibleSegments(drawing, family, geometry);
      const points = rendered.flatMap((segment) => [segment.a, segment.b]);
      const minX = Math.min(geometry.left, ...points.map((point) => point.x));
      const maxX = Math.max(geometry.right, ...points.map((point) => point.x));
      const minY = Math.min(geometry.top, ...points.map((point) => point.y));
      const maxY = Math.max(geometry.bottom, ...points.map((point) => point.y));
      const resolved = resolveGannConfig(drawing.gann, family);
      const showRanges = resolved.family === "square" && resolved.showRanges;
      return {
        x: minX - TOL,
        y: minY - TOL - (showRanges ? 18 : 0),
        w: maxX - minX + TOL * 2 + (showRanges ? 80 : 0),
        h: maxY - minY + TOL * 2 + (showRanges ? 32 : 0),
      };
    },
  };
}

registerTool(createGannGrid("gannSquare", "square"));
registerTool(createGannGrid("gannBox", "box"));
