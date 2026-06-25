/**
 * VerticalLineTool — renders and hit-tests a vertical time line.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import { type DrawingToolPlugin, registerTool, defaultMovePoints, TOL } from "../ToolRegistry";
import { line, handle, applyStyle } from "./shared";

const plugin: DrawingToolPlugin = {
  tool: "vertical",
  minPoints: 1,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const x = proj.toX(d.points[0].time);
    if (x == null) return;
    line(g, x, 0, x, proj.height);
    if (selected) handle(g, x, proj.height / 2, d.color);
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const x = toX(d.points[0].time);
    if (x != null && Math.abs(x - px) < TOL) {
      return [{ drawing: d, target: "body", distance: Math.abs(x - px) }];
    }
    return [];
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, _toY: HitTestProjector) {
    const x = toX(d.points[0].time);
    if (x == null) return null;
    return { x: x - TOL, y: 0, w: TOL * 2, h: 9999 };
  },
};

registerTool(plugin);
