/**
 * HorizontalRayTool - horizontal ray starting at one anchor and extending right.
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
import { drawPriceAxisLabel } from "./axisLabels";
import {
  horizontalRayBodyHits,
  horizontalRayBounds,
  onePointAnchorHits,
  onePointAnchors,
  projectOnePoint,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "horizRay",
  minPoints: 1,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const anchor = projectOnePoint(d, proj.toX, proj.toY);
    if (!anchor) return;
    line(g, anchor.x, anchor.y, proj.width, anchor.y);
    renderLineText(g, d, anchor.x, anchor.y, proj.width, anchor.y, selected);
    if (d.showPriceLabels !== false) drawPriceAxisLabel(g, d, proj, anchor.y);
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
      ...horizontalRayBodyHits(d, anchor, px, py),
    ];
  },
  getAnchors: onePointAnchors,
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    return horizontalRayBounds(projectOnePoint(d, toX, toY));
  },
};

registerTool(plugin);
