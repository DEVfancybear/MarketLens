/**
 * RayTool - one-way infinite line starting at the first point and extending
 * through the second point.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line } from "./shared";
import { renderTwoPointLineParity } from "./lineParity";
import {
  fullViewportBounds,
  projectTwoPoints,
  rayBodyHits,
  rayRenderSegment,
  twoPointAnchorHits,
  twoPointAnchors,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "ray",
  minPoints: 2,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const segment = projectTwoPoints(d, proj.toX, proj.toY);
    if (!segment) return;
    const rendered = rayRenderSegment(segment, proj);
    line(g, rendered.a.x, rendered.a.y, rendered.b.x, rendered.b.y);
    renderTwoPointLineParity(g, d, segment, rendered, selected, proj);
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
      ...rayBodyHits(d, segment, px, py),
    ];
  },
  getAnchors: twoPointAnchors,
  movePoints: defaultMovePoints,
  boundingBox: fullViewportBounds,
};

registerTool(plugin);
