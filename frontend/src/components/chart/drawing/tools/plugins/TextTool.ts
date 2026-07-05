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

const WRAP_WIDTH = 220;
const TEXT_PAD_X = 4;
const TEXT_PAD_Y = 3;

function textLines(d: Drawing) {
  const text = d.text ?? "";
  return text.length > 0 ? text.split("\n") : [""];
}

function wrapLineByApproxWidth(line: string, fs: number) {
  if (!line || line.length * fs * 0.55 <= WRAP_WIDTH) return [line];
  const words = line.split(/(\s+)/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current + word;
    if (current && next.length * fs * 0.55 > WRAP_WIDTH) {
      lines.push(current.trimEnd());
      current = word.trimStart();
    } else {
      current = next;
    }
  }
  if (current) lines.push(current.trimEnd());
  return lines.length > 0 ? lines : [line];
}

function visualTextLines(d: Drawing, fs: number) {
  const lines = textLines(d);
  if (!d.textWrap) return lines;
  return lines.flatMap((line) => wrapLineByApproxWidth(line, fs));
}

function approximateTextBox(d: Drawing, x: number, y: number) {
  const fs = d.fontSize ?? 13;
  const lineHeight = fs * 1.22;
  const lines = visualTextLines(d, fs);
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
    const box = measuredTextBox(g, d, x, y);
    if (d.textBackground || d.textBorder) {
      const bx = box.x - TEXT_PAD_X;
      const by = box.y - TEXT_PAD_Y;
      const bw = box.w + TEXT_PAD_X * 2;
      const bh = box.h + TEXT_PAD_Y * 2;
      if (d.textBackground) {
        g.fillStyle = d.textBackgroundColor || "rgba(54,58,69,0.85)";
        g.fillRect(bx, by, bw, bh);
      }
      if (d.textBorder) {
        g.strokeStyle = d.textBorderColor || d.color;
        g.lineWidth = 1;
        g.setLineDash([]);
        g.strokeRect(bx, by, bw, bh);
      }
    }
    g.fillStyle = d.textColor || d.color;
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
