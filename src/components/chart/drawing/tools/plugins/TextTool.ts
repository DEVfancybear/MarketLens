/**
 * TextTool — renders and hit-tests a text annotation.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
} from "../ToolRegistry";
import { handle } from "./shared";

const plugin: DrawingToolPlugin = {
  tool: "text",
  minPoints: 1,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const x = proj.toX(d.points[0].time),
      y = proj.toY(d.points[0].price);
    if (x == null || y == null) return;
    const txt = d.text || "";
    g.save();
    g.font = "13px var(--font-sans)";
    g.fillStyle = d.color;
    g.fillText(txt, x, y);
    if (selected) handle(g, x, y, d.color);
    g.restore();
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
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
          target: "label",
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
