/**
 * CrossLineTool - one anchor that draws vertical and horizontal guide lines.
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
import { drawPriceAxisLabel, drawTimeAxisLabel } from "./axisLabels";
import {
  fullViewportBounds,
  horizontalLineBodyHits,
  onePointAnchorHits,
  onePointAnchors,
  projectOnePoint,
  verticalLineBodyHits,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "crossLine",
  minPoints: 1,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const anchor = projectOnePoint(d, proj.toX, proj.toY);
    if (!anchor) return;
    line(g, anchor.x, 0, anchor.x, proj.height);
    line(g, 0, anchor.y, proj.width, anchor.y);
    if (d.showPriceLabels !== false) drawPriceAxisLabel(g, d, proj, anchor.y);
    if (d.showTimeLabel !== false) drawTimeAxisLabel(g, d, proj, anchor.x);
    if (selected) handle(g, anchor.x, anchor.y, d.color);
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const anchor = projectOnePoint(d, toX, toY);
    return [
      ...onePointAnchorHits(d, anchor, px, py),
      ...verticalLineBodyHits(d, anchor?.x ?? null, px),
      ...horizontalLineBodyHits(d, anchor?.y ?? null, py),
    ];
  },
  getAnchors: onePointAnchors,
  movePoints: defaultMovePoints,
  boundingBox: fullViewportBounds,
};

registerTool(plugin);
