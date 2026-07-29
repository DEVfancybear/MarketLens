/**
 * RectangleTool — renders and hit-tests a two-point rectangle (supply/demand zone).
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
  TOL, distToRect,
} from "../ToolRegistry";
import {
  BOX_CORNER_HANDLE_IDS,
  boxSelectionAnchorHits,
  boxSelectionAnchors,
  moveBoxSelectionAnchor,
} from "../boxSelectionHandles";
import {
  handle,
  squareHandle,
  applyStyle,
  line,
  renderShapeText,
} from "./shared";

const EXTENDED_RECT_SPAN = 100000;

function projectedHorizontalBounds(d: Drawing, x1: number, x2: number) {
  let left = Math.min(x1, x2);
  let right = Math.max(x1, x2);
  const ext = d.extend ?? "none";
  if (ext === "left" || ext === "both") left = -EXTENDED_RECT_SPAN;
  if (ext === "right" || ext === "both") right = EXTENDED_RECT_SPAN;
  return { left, right };
}

const plugin: DrawingToolPlugin = {
  tool: "rectangle",
  minPoints: 2,
  render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
    const x1 = proj.toX(d.points[0].time), y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time), y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    let ox = Math.min(x1, x2), oy = Math.min(y1, y2);
    let w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    // Extend the box horizontally across the chart (TradingView "Extend").
    const ext = d.extend ?? "none";
    if (ext === "left" || ext === "both") { w += ox; ox = 0; }
    if (ext === "right" || ext === "both") w = proj.width - ox;
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.fillStyle = d.fillColor;
      g.globalAlpha = d.opacity ?? 0.3;
      g.fillRect(ox, oy, w, h);
      g.globalAlpha = 1;
      g.restore();
    }
    g.strokeRect(ox, oy, w, h);
    // Middle line — horizontal divider at the vertical centre.
    if (d.showMiddleLine) {
      g.save();
      g.strokeStyle = d.middleLineColor || d.color;
      applyStyle(g, d.middleLineStyle ?? "dashed");
      const my = oy + h / 2;
      line(g, ox, my, ox + w, my);
      g.restore();
    }
    // Inner text with alignment + bold/italic.
    renderShapeText(g, d, ox, oy, w, h);
    if (selected) {
      for (const anchor of boxSelectionAnchors(d, proj.toX, proj.toY)) {
        if (anchor.x == null || anchor.y == null) continue;
        if (BOX_CORNER_HANDLE_IDS.has(anchor.index)) {
          handle(g, anchor.x, anchor.y, d.color);
        } else {
          squareHandle(g, anchor.x, anchor.y, d.color);
        }
      }
    }
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return [];
    const results = boxSelectionAnchorHits(d, px, py, toX, toY);
    const { left, right } = projectedHorizontalBounds(d, x1, x2);
    const bodyDist = distToRect(px, py, left, y1, right, y2);
    if (bodyDist < TOL) results.push({ drawing: d, target: "body", distance: bodyDist });
    return results;
  },
  movePoints: defaultMovePoints,
  moveAnchor: moveBoxSelectionAnchor,
  getAnchors: boxSelectionAnchors,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    const { left, right } = projectedHorizontalBounds(d, x1, x2);
    return {
      x: left,
      y: Math.min(y1, y2),
      w: right - left,
      h: Math.abs(y2 - y1),
    };
  },
};

registerTool(plugin);
