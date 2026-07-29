/**
 * EmojiTool — renders and hit-tests an emoji annotation.
 */
import type { Drawing } from "@/types";
import { DEFAULT_EMOJI_SELECTION } from "../../../../../types/emojiCatalog";
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
  const text = d.text || DEFAULT_EMOJI_SELECTION.value;
  const visibleUnits = Math.max(
    1,
    Array.from(text).filter(
      (character) =>
        character !== "\uFE0E" &&
        character !== "\uFE0F" &&
        character !== "\u200D",
    ).length,
  );
  const width = size * Math.max(1.2, visibleUnits * 0.9);
  return {
    x: x - width / 2,
    y: y - size * 0.65,
    w: width,
    h: size * 1.3,
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
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(d.text || DEFAULT_EMOJI_SELECTION.value, x, y);
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
