/** Phase 8 Wave A measurement-range family. */
import type { Drawing, DrawingTool } from "@/types";
import type { Projector } from "../../drawingRenderer";
import type { HitResult, HitTestProjector } from "../../hittest/HitTestEngine";
import {
  TOL,
  defaultMovePoints,
  registerTool,
  type DrawingToolPlugin,
} from "../ToolRegistry";
import { chip, handle, renderShapeText } from "./shared";
import { projectTwoPoints, twoPointAnchors, twoPointAnchorHits } from "./lineGeometry";

type RangeKind = "price" | "date" | "both";

function bounds(d: Drawing, toX: HitTestProjector, toY: HitTestProjector) {
  const segment = projectTwoPoints(d, toX, toY);
  if (!segment) return null;
  const left = Math.min(segment.a.x, segment.b.x);
  const right = Math.max(segment.a.x, segment.b.x);
  const top = Math.min(segment.a.y, segment.b.y);
  const bottom = Math.max(segment.a.y, segment.b.y);
  return { segment, left, right, top, bottom, width: right - left, height: bottom - top };
}

function durationLabel(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function rangeLabel(d: Drawing, kind: RangeKind) {
  const [a, b] = d.points;
  if (!a || !b) return "";
  const priceDelta = b.price - a.price;
  const percent = a.price === 0 ? 0 : (priceDelta / Math.abs(a.price)) * 100;
  const price = `${priceDelta >= 0 ? "+" : ""}${priceDelta.toFixed(2)} (${percent.toFixed(2)}%)`;
  const date = durationLabel(Math.abs(b.time - a.time));
  if (kind === "price") return price;
  if (kind === "date") return date;
  return `${price} · ${date}`;
}

function createRangeTool(tool: DrawingTool, kind: RangeKind): DrawingToolPlugin {
  return {
    tool,
    minPoints: 2,
    render(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
      const box = bounds(d, proj.toX, proj.toY);
      if (!box) return;
      let { left, right, top, bottom } = box;
      if (kind === "price") {
        if (d.extend === "left" || d.extend === "both") left = 0;
        if (d.extend === "right" || d.extend === "both") right = proj.width;
      }
      g.save();
      if (d.fillColor !== "transparent") {
        g.fillStyle = d.fillColor || d.color;
        g.globalAlpha = d.opacity ?? 0.12;
        g.fillRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
      }
      g.globalAlpha = 1;
      g.strokeStyle = d.color;
      g.lineWidth = d.lineWidth;
      if (kind !== "date") {
        g.beginPath();
        g.moveTo(left, top); g.lineTo(right, top);
        g.moveTo(left, bottom); g.lineTo(right, bottom);
        g.stroke();
      }
      if (kind !== "price") {
        g.beginPath();
        g.moveTo(left, top); g.lineTo(left, bottom);
        g.moveTo(right, top); g.lineTo(right, bottom);
        g.stroke();
      }
      if (kind === "both") g.strokeRect(left, top, right - left, bottom - top);
      if (d.showStats !== false) {
        chip(g, rangeLabel(d, kind), left + 4, Math.max(2, top - 20), d.color, 0.9);
      }
      renderShapeText(g, d, left, top, right - left, bottom - top);
      if (selected) {
        handle(g, box.segment.a.x, box.segment.a.y, d.color);
        handle(g, box.segment.b.x, box.segment.b.y, d.color);
      }
      g.restore();
    },
    hitTest(d, px, py, toX, toY): HitResult[] {
      const box = bounds(d, toX, toY);
      if (!box) return [];
      const anchors = twoPointAnchorHits(d, box.segment, px, py);
      const inside = px >= box.left - TOL && px <= box.right + TOL && py >= box.top - TOL && py <= box.bottom + TOL;
      return inside ? [...anchors, { drawing: d, target: "body", distance: 1 }] : anchors;
    },
    movePoints: defaultMovePoints,
    getAnchors: twoPointAnchors,
    boundingBox(d, toX, toY) {
      const box = bounds(d, toX, toY);
      return box ? { x: box.left - 24, y: box.top - 24, w: box.width + 48, h: box.height + 48 } : null;
    },
  };
}

registerTool(createRangeTool("priceRange", "price"));
registerTool(createRangeTool("dateRange", "date"));
registerTool(createRangeTool("datePriceRange", "both"));
