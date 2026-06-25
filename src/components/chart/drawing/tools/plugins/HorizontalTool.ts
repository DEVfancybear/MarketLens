/**
 * HorizontalLineTool — renders and hit-tests a horizontal price line.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints, TOL,
} from "../ToolRegistry";
import { line, chip, handle, applyStyle } from "./shared";

const plugin: DrawingToolPlugin = {
  tool: "horizontal",
  minPoints: 1,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const y = proj.toY(d.points[0].price);
    if (y == null) return;
    line(g, 0, y, proj.width, y);
    chip(g, d.points[0].price.toFixed(4), 2, y - 9, d.color);
    if (selected) handle(g, 0, y, d.color);
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const y = toY(d.points[0].price);
    if (y != null && Math.abs(y - py) < TOL) {
      return [{ drawing: d, target: "body", distance: Math.abs(y - py) }];
    }
    return [];
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const y = toY(d.points[0].price);
    if (y == null) return null;
    return { x: 0, y: y - TOL, w: 9999, h: TOL * 2 };
  },
};

registerTool(plugin);
