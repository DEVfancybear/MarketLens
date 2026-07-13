/**
 * HorizontalLineTool - full-width one-price line.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line, chip, handle } from "./shared";
import {
  horizontalBounds,
  horizontalLineBodyHits,
  moveHorizontalLine,
  moveHorizontalLineAnchor,
  onePointAnchors,
  onePointAnchorHits,
  projectOnePoint,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "horizontal",
  minPoints: 1,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const y = proj.toY(d.points[0].price);
    if (y == null) return;
    line(g, 0, y, proj.width, y);
    chip(g, d.points[0].price.toFixed(4), 2, y - 9, d.color);
    const anchor = projectOnePoint(d, proj.toX, proj.toY);
    if (selected && anchor) handle(g, anchor.x, y, d.color);
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const anchor = projectOnePoint(d, toX, toY);
    const y = toY(d.points[0].price);
    return [
      ...onePointAnchorHits(d, anchor, px, py),
      ...horizontalLineBodyHits(d, y, py),
    ];
  },
  getAnchors: onePointAnchors,
  movePoints: defaultMovePoints,
  move: (orig, pointer, dragStart) =>
    moveHorizontalLine(orig, pointer, dragStart),
  moveAnchor: (orig, _index, pointer) =>
    moveHorizontalLineAnchor(orig, pointer),
  boundingBox(d: Drawing, _toX: HitTestProjector, toY: HitTestProjector) {
    return horizontalBounds(toY(d.points[0].price));
  },
};

registerTool(plugin);
