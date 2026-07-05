/**
 * ExtendedLineTool - infinite line through two anchor points.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line, handle } from "./shared";
import {
  extendedLineBodyHits,
  extendedRenderSegment,
  fullViewportBounds,
  projectTwoPoints,
  twoPointAnchorHits,
  twoPointAnchors,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "extendedLine",
  minPoints: 2,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const segment = projectTwoPoints(d, proj.toX, proj.toY);
    if (!segment) return;
    const rendered = extendedRenderSegment(segment, proj);
    line(g, rendered.a.x, rendered.a.y, rendered.b.x, rendered.b.y);
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
      ...extendedLineBodyHits(d, segment, px, py),
    ];
  },
  getAnchors: twoPointAnchors,
  movePoints: defaultMovePoints,
  boundingBox: fullViewportBounds,
};

registerTool(plugin);
