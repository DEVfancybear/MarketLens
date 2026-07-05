/**
 * TrendAngleTool - finite two-point line with an angle arc and label.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line, handle, chip, angleDeg, angleArc } from "./shared";
import {
  finiteSegmentBodyHits,
  projectTwoPoints,
  twoPointAnchorHits,
  twoPointAnchors,
  twoPointBounds,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "trendAngle",
  minPoints: 2,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const segment = projectTwoPoints(d, proj.toX, proj.toY);
    if (!segment) return;
    line(g, segment.a.x, segment.a.y, segment.b.x, segment.b.y);
    angleArc(g, segment.a.x, segment.a.y, segment.b.x, segment.b.y, d.color);
    const deg = angleDeg(segment.a.x, segment.a.y, segment.b.x, segment.b.y);
    chip(g, `${deg.toFixed(1)}\u00B0`, segment.a.x + 32, segment.a.y - 9, d.color);
    if (selected) {
      handle(g, segment.a.x, segment.a.y, d.color);
      handle(g, segment.b.x, segment.b.y, d.color);
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
    return twoPointBounds(projectTwoPoints(d, toX, toY), 40);
  },
};

registerTool(plugin);
