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
import { canvasFont, line } from "./shared";
import {
  moveVerticalLine,
  moveVerticalLineAnchor,
  verticalBounds,
  verticalLineBodyHits,
} from "./lineGeometry";

const DATE_LABEL_H = 20;
const DATE_LABEL_PAD_X = 8;
const DATE_LABEL_BOTTOM_GAP = 3;
const DATE_LABEL_RADIUS = 2;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatVerticalDateLabel(timeSec: number): string {
  const d = new Date(timeSec * 1000);
  return `${WEEKDAYS[d.getUTCDay()]} ${pad2(d.getUTCDate())} ${
    MONTHS[d.getUTCMonth()]
  } ${pad2(d.getUTCFullYear() % 100)} ${pad2(d.getUTCHours())}:${pad2(
    d.getUTCMinutes(),
  )}`;
}

function roundedRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawDateLabel(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  d: Drawing,
  proj: Projector,
) {
  const text = formatVerticalDateLabel(d.points[0].time);
  g.save();
  g.setLineDash([]);
  g.font = canvasFont(11, { weight: 600 });
  const w = Math.min(
    Math.ceil(g.measureText(text).width + DATE_LABEL_PAD_X * 2),
    Math.max(36, proj.width - 8),
  );
  const chipX = Math.max(4, Math.min(x - w / 2, proj.width - w - 4));

  roundedRect(g, chipX, y, w, DATE_LABEL_H, DATE_LABEL_RADIUS);
  g.fillStyle = d.color;
  g.fill();
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, chipX + w / 2, y + DATE_LABEL_H / 2 + 0.5, w - 8);
  g.restore();
}

const plugin: DrawingToolPlugin = {
  tool: "vertical",
  minPoints: 1,
  render(
    g: CanvasRenderingContext2D,
    d: Drawing,
    proj: Projector,
    selected: boolean,
  ) {
    const x = proj.toX(d.points[0].time);
    if (x == null) return;
    line(g, x, 0, x, proj.height);
    if (selected) {
      drawDateLabel(
        g,
        x,
        Math.max(0, proj.height - DATE_LABEL_H - DATE_LABEL_BOTTOM_GAP),
        d,
        proj,
      );
    }
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
