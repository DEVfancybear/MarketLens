/**
 * RectangleTool — renders and hit-tests a two-point rectangle (supply/demand zone).
 */
import type { Drawing } from "@/types";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import type { Projector } from "../../drawingRenderer";
import {
  type DrawingToolPlugin, registerTool, defaultMovePoints,
  HANDLE_RADIUS, TOL, pointDist, distToRect,
} from "../ToolRegistry";
import { handle, applyStyle, line, canvasFont } from "./shared";

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
    if (d.text) {
      g.save();
      g.setLineDash([]);
      const fs = d.fontSize ?? 14;
      g.font = canvasFont(fs, { bold: d.bold, italic: d.italic });
      g.fillStyle = d.textColor || d.color;
      const pad = 6;
      const hAlign = d.textHAlign ?? "center";
      const vAlign = d.textVAlign ?? "middle";
      g.textAlign = hAlign;
      g.textBaseline = vAlign === "middle" ? "middle" : vAlign === "top" ? "top" : "bottom";
      const tx = hAlign === "left" ? ox + pad : hAlign === "right" ? ox + w - pad : ox + w / 2;
      const ty = vAlign === "top" ? oy + pad : vAlign === "bottom" ? oy + h - pad : oy + h / 2;
      for (const [i, ln] of d.text.split("\n").entries())
        g.fillText(ln, tx, ty + i * fs * 1.25);
      g.restore();
    }
    if (selected) { handle(g, x1, y1, d.color); handle(g, x2, y2, d.color); }
  },
  hitTest(d: Drawing, px: number, py: number, toX: HitTestProjector, toY: HitTestProjector): HitResult[] {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS) results.push({ drawing: d, target: "p1", distance: pointDist(px, py, x1, y1) });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS) results.push({ drawing: d, target: "p2", distance: pointDist(px, py, x2, y2) });
    const bodyDist = distToRect(px, py, x1, y1, x2, y2);
    if (bodyDist < TOL) results.push({ drawing: d, target: "body", distance: bodyDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
    const x1 = toX(d.points[0].time), y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time), y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  },
};

registerTool(plugin);
