/**
 * TrendLineTool - finite two-point trend line.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line, handle, renderLineText } from "./shared";
import {
  finiteSegmentBodyHits,
  projectTwoPoints,
  twoPointAnchorHits,
  twoPointAnchors,
  twoPointBounds,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "trendline",
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
    renderLineText(
      g,
      d,
      segment.a.x,
      segment.a.y,
      segment.b.x,
      segment.b.y,
      selected,
    );
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
    return twoPointBounds(projectTwoPoints(d, toX, toY));
  },
};

registerTool(plugin);
