/**
 * VerticalLineTool - renders and hit-tests a vertical time line.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { line, renderLineText } from "./shared";
import { drawTimeAxisLabel } from "./axisLabels";
import {
  moveVerticalLine,
  moveVerticalLineAnchor,
  verticalBounds,
  verticalLineBodyHits,
} from "./lineGeometry";

const plugin: DrawingToolPlugin = {
  tool: "vertical",
  minPoints: 1,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    _selected: boolean,
  ) {
    const x = proj.toX(d.points[0].time);
    if (x == null) return;
    line(g, x, 0, x, proj.height);
    // Keep the attached text on the same projected geometry as the axis line.
    // The DOM overlay targets the time badge for editing; this canvas label is
    // what remains visible after the editor is committed.
    renderLineText(g, d, x, 0, x, proj.height, _selected);
    if (d.showTimeLabel !== false) drawTimeAxisLabel(g, d, proj, x);
  },
  hitTest(
    d: Drawing,
    px: number,
    _py: number,
    toX: HitTestProjector,
    _toY: HitTestProjector,
  ): HitResult[] {
    const x = toX(d.points[0].time);
    return verticalLineBodyHits(d, x, px);
  },
  move: (orig, pointer, dragStart) =>
    moveVerticalLine(orig, pointer, dragStart),
  moveAnchor: (orig, _index, pointer) =>
    moveVerticalLineAnchor(orig, pointer),
  movePoints: defaultMovePoints,
  getAnchors: () => [],
  boundingBox(d: Drawing, toX: HitTestProjector, _toY: HitTestProjector) {
    return verticalBounds(toX(d.points[0].time));
  },
};

registerTool(plugin);
