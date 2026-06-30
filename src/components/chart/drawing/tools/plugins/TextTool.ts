/**
 * TextTool — renders and hit-tests a text annotation.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { handle } from "./shared";

const plugin: DrawingToolPlugin = {
  tool: "text",
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
    const txt = d.text || "";
    const fs = d.fontSize ?? 13;
    g.save();
    g.font = `${d.italic ? "italic " : ""}${d.bold ? "bold " : ""}${fs}px var(--font-sans)`;
    g.fillStyle = d.textColor || d.color;
    g.fillText(txt, x, y);
    // Don't show selection handle for text — user finds circle distracting.
    g.restore();
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
    if (x == null || y == null) return [];
    // Text is drawn left-anchored on an alphabetic baseline, so it spans
    // [x, x+width] × [y-ascent, y+descent]. Approximate width/height from the
    // font size so the hit box scales when the user changes the size.
    const fs = d.fontSize ?? 13;
    const w = Math.max(20, (d.text?.length ?? 0) * fs * 0.55);
    if (px >= x - 4 && px <= x + w + 4 && py >= y - fs && py <= y + fs * 0.35) {
      return [
        {
          drawing: d,
          target: "body",
          distance: Math.max(2, Math.abs(y - (y - fs / 2))),
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
    const fs = d.fontSize ?? 13;
    const w = Math.max(20, (d.text?.length ?? 0) * fs * 0.55);
    return { x: x - 4, y: y - fs, w: w + 8, h: fs * 1.35 };
  },
};

registerTool(plugin);
