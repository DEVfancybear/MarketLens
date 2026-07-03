/**
 * TextTool - renders and hit-tests a text annotation.
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin,
  registerTool,
  defaultMovePoints,
} from "../ToolRegistry";
import { canvasFont } from "./shared";

function textLines(d: Drawing) {
  const text = d.text ?? "";
  return text.length > 0 ? text.split("\n") : [""];
}

function approximateTextBox(d: Drawing, x: number, y: number) {
  const fs = d.fontSize ?? 13;
  const lineHeight = fs * 1.22;
  const lines = textLines(d);
  const width = Math.max(
    20,
    ...lines.map((line) => (line || " ").length * fs * 0.55),
  );
  const height = fs + Math.max(0, lines.length - 1) * lineHeight + fs * 0.25;
  return { x, y: y - fs, w: width, h: height, fs, lineHeight, lines };
}

function measuredTextBox(
  g: CanvasRenderingContext2D,
  d: Drawing,
  x: number,
  y: number,
) {
  const box = approximateTextBox(d, x, y);
  return {
    ...box,
    w: Math.max(
      20,
      ...box.lines.map((line) => g.measureText(line || " ").width),
    ),
  };
}

const plugin: DrawingToolPlugin = {
  tool: "text",
  minPoints: 1,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const x = proj.toX(d.points[0].time);
    const y = proj.toY(d.points[0].price);
    if (x == null || y == null) return;

    const fs = d.fontSize ?? 13;
    g.save();
    g.font = canvasFont(fs, { bold: d.bold, italic: d.italic });
    g.fillStyle = d.textColor || d.color;
    const box = measuredTextBox(g, d, x, y);
    for (const [index, line] of box.lines.entries()) {
      g.fillText(line, x, y + index * box.lineHeight);
    }
    if (selected) {
      g.strokeStyle = "#2962ff";
      g.lineWidth = 1.5;
      g.setLineDash([]);
      g.strokeRect(box.x - 3, box.y - 3, box.w + 6, box.h + 6);
    }
    g.restore();
  },
  hitTest(
    d: Drawing,
    px: number,
    py: number,
    toX: HitTestProjector,
    toY: HitTestProjector,
  ): HitResult[] {
    const x = toX(d.points[0].time);
    const y = toY(d.points[0].price);
    if (x == null || y == null) return [];

    const box = approximateTextBox(d, x, y);
    if (
      px >= box.x - 4 &&
      px <= box.x + box.w + 4 &&
      py >= box.y - 4 &&
      py <= box.y + box.h + 4
    ) {
      return [
        {
          drawing: d,
          target: "body",
          distance: Math.max(2, Math.abs(y - (box.y + box.h / 2))),
        },
      ];
    }
    return [];
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x = toX(d.points[0].time);
    const y = toY(d.points[0].price);
    if (x == null || y == null) return null;
    const box = approximateTextBox(d, x, y);
    return { x: box.x - 4, y: box.y - 4, w: box.w + 8, h: box.h + 8 };
  },
};

registerTool(plugin);
