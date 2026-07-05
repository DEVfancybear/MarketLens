/**
 * EmojiTool — renders and hit-tests an emoji annotation.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { handle, canvasFont } from "./shared";

const plugin: DrawingToolPlugin = {
  tool: "emoji",
  minPoints: 1,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const x = proj.toX(d.points[0].time),
      y = proj.toY(d.points[0].price);
    if (x == null || y == null) return;
    g.save();
    const fs = d.fontSize ?? 20;
    g.font = canvasFont(fs);
    g.fillStyle = d.color;
    g.fillText(d.text || "", x - fs * 0.45, y + fs * 0.35);
    g.restore();
    if (selected) handle(g, x, y, d.color);
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const x = toX(d.points[0].time),
      y = toY(d.points[0].price);
    if (
      x != null &&
      y != null &&
      Math.abs(x - px) < 40 &&
      Math.abs(y - py) < 14
    ) {
      return [
        {
          drawing: d,
          target: "body",
          distance: Math.max(Math.abs(x - px), Math.abs(y - py)),
        },
      ];
    }
    return [];
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x = toX(d.points[0].time),
      y = toY(d.points[0].price);
    if (x == null || y == null) return null;
    return { x: x - 20, y: y - 7, w: 40, h: 14 };
  },
};

registerTool(plugin);
