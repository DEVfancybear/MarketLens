import type { Drawing } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import {
  TOL,
  defaultMovePoints,
  registerTool,
  type DrawingToolPlugin,
} from "../ToolRegistry";
import { applyStyle, handle } from "./shared";
import {
  anchorHits,
  anchorsFromProjected,
  boundsFromPoints,
  curveBodyHits,
  projectPoints,
  strokeHitTolerance,
  type XY,
} from "./shapeGeometry";

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;
const SPIRAL_TURNS = 2.5;
const SPIRAL_SAMPLES = 160;

/**
 * TradingView's Fib Spiral is a two-anchor logarithmic spiral. The first
 * anchor is its center and the second fixes the outer radius and rotation.
 * Each quarter turn contracts by the golden ratio toward the center.
 */
export function fibSpiralSamples(
  center: XY,
  edge: XY,
  reverse = false,
): XY[] {
  const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
  if (radius < 0.5) return [center, edge];
  const outerAngle = Math.atan2(edge.y - center.y, edge.x - center.x);
  const direction = reverse ? -1 : 1;
  const samples: XY[] = [];
  for (let index = SPIRAL_SAMPLES; index >= 0; index--) {
    const theta = (index / SPIRAL_SAMPLES) * SPIRAL_TURNS * Math.PI * 2;
    const sampleRadius = radius * Math.pow(GOLDEN_RATIO, -theta / (Math.PI / 2));
    const angle = outerAngle - direction * theta;
    samples.push({
      x: center.x + Math.cos(angle) * sampleRadius,
      y: center.y + Math.sin(angle) * sampleRadius,
    });
  }
  return samples;
}

function projectedGeometry(
  drawing: Drawing,
  toX: HitTestProjector,
  toY: HitTestProjector,
) {
  const anchors = projectPoints(drawing.points.slice(0, 2), toX, toY);
  const center = anchors[0];
  const edge = anchors[1];
  return {
    anchors,
    samples: center && edge
      ? fibSpiralSamples(center, edge, drawing.fibReverse)
      : [],
  };
}

const plugin: DrawingToolPlugin = {
  tool: "fibSpiral",
  minPoints: 2,
  render(g: CanvasRenderingContext2D, drawing: Drawing, proj: Projector, selected: boolean) {
    const geometry = projectedGeometry(drawing, proj.toX, proj.toY);
    if (geometry.samples.length < 2) return;
    g.save();
    g.strokeStyle = drawing.fibUseOneColor
      ? drawing.fibLevelLineColor || drawing.color
      : drawing.color;
    g.lineWidth = drawing.fibLevelLineWidth ?? drawing.lineWidth;
    applyStyle(g, drawing.fibLevelLineStyle ?? drawing.lineStyle ?? "solid");
    g.beginPath();
    g.moveTo(geometry.samples[0].x, geometry.samples[0].y);
    for (let index = 1; index < geometry.samples.length; index++) {
      g.lineTo(geometry.samples[index].x, geometry.samples[index].y);
    }
    g.stroke();
    if (selected) {
      for (const point of geometry.anchors) {
        if (point) handle(g, point.x, point.y, drawing.color);
      }
    }
    g.restore();
  },
  hitTest(drawing, px, py, toX, toY): HitResult[] {
    const geometry = projectedGeometry(drawing, toX, toY);
    return [
      ...anchorHits(drawing, geometry.anchors, px, py),
      ...curveBodyHits(
        drawing,
        geometry.samples,
        px,
        py,
        Math.max(TOL, strokeHitTolerance(drawing.lineWidth)),
      ),
    ];
  },
  getAnchors(drawing, toX, toY) {
    return anchorsFromProjected(
      projectedGeometry(drawing, toX, toY).anchors,
    );
  },
  movePoints: defaultMovePoints,
  boundingBox(drawing, toX, toY) {
    return boundsFromPoints(
      projectedGeometry(drawing, toX, toY).samples,
      Math.max(1, (drawing.lineWidth ?? 1.5) / 2),
    );
  },
};

registerTool(plugin);
