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
  HANDLE_RADIUS,
} from "../ToolRegistry";
import { handle, canvasFont } from "./shared";

function emojiBox(d: Drawing, x: number, y: number) {
  const size = Math.max(12, d.fontSize ?? 20);
  return {
    x: x - size * 0.6,
    y: y - size * 0.7,
    w: size * 1.2,
    h: size * 1.2,
  };
}

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
    if (x != null && y != null) {
      const anchorDistance = Math.hypot(x - px, y - py);
      if (anchorDistance <= HANDLE_RADIUS) {
        return [{
          drawing: d,
          target: "p1",
          anchorIndex: 0,
          distance: anchorDistance,
        }];
      }
      const box = emojiBox(d, x, y);
      if (px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h) {
        return [];
      }
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
    return emojiBox(d, x, y);
  },
};

registerTool(plugin);
