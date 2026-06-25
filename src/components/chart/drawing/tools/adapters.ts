/**
 * Tool adapters — one per drawing tool.
 *
 * Each adapter implements the ToolAdapter interface for its tool type.
 * Registered automatically on import via registerAdapter().
 *
 * To add a new tool:
 *   1. Create a new const adapter: ToolAdapter = { ... }
 *   2. Call registerAdapter(adapter)
 *   3. Add the tool to DrawingTool union in types/drawing.ts
 *   Done — no switch changes anywhere else.
 */
import type { Drawing, Point as Pt, DrawingTool } from "@/types";
import { FIB_LEVELS } from "@/types";
import type { HitResult, HitTestProjector } from "../hittest/HitTestEngine";
import type { Projector } from "../drawingRenderer";
import {
  type ToolAdapter,
  registerAdapter,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
  distToRect,
} from "./ToolRegistry";

// ---- Canvas drawing helpers (minimised, shared) ----

function line(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function handle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
) {
  g.save();
  g.fillStyle = "#fff";
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.setLineDash([]);
  g.beginPath();
  g.arc(x, y, 4, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}

function chip(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  g.save();
  g.font = "11px var(--font-sans)";
  const w = g.measureText(text).width + 10;
  g.fillStyle = color;
  g.globalAlpha = 0.85;
  g.beginPath();
  g.roundRect(x, y, w, 18, 4);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = "#fff";
  g.textBaseline = "middle";
  g.fillText(text, x + 5, y + 9);
  g.restore();
}

function applyStyle(g: CanvasRenderingContext2D, style: string | undefined) {
  if (style === "dashed") g.setLineDash([6, 3]);
  else if (style === "dotted") g.setLineDash([2, 3]);
  else g.setLineDash([]);
}

// ==================================================================
// Adapter implementations
// ==================================================================

// ---- Horizontal Line ----
registerAdapter({
  tool: "horizontal",
  minPoints: 1,
  render(g, d, proj, selected) {
    const y = proj.toY(d.points[0].price);
    if (y == null) return;
    line(g, 0, y, proj.width, y);
    chip(g, d.points[0].price.toFixed(4), 2, y - 9, d.color);
    if (selected) handle(g, 0, y, d.color);
  },
  hitTest(d, px, py, toX, toY) {
    const y = toY(d.points[0].price);
    if (y != null && Math.abs(y - py) < TOL) {
      return [{ drawing: d, target: "body", distance: Math.abs(y - py) }];
    }
    return [];
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const y = toY(d.points[0].price);
    if (y == null) return null;
    return { x: 0, y: y - TOL, w: 9999, h: TOL * 2 };
  },
});

// ---- Horizontal Ray ----
registerAdapter({
  tool: "horizRay",
  minPoints: 1,
  render(g, d, proj, selected) {
    const y = proj.toY(d.points[0].price);
    const xS = proj.toX(d.points[0].time) ?? 0;
    if (y == null) return;
    line(g, xS, y, proj.width, y);
    chip(g, d.points[0].price.toFixed(4), 2, y - 9, d.color);
    if (selected) handle(g, xS, y, d.color);
  },
  hitTest(d, px, py, toX, toY) {
    const y = toY(d.points[0].price);
    if (y != null && Math.abs(y - py) < TOL) {
      return [{ drawing: d, target: "body", distance: Math.abs(y - py) }];
    }
    return [];
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const y = toY(d.points[0].price);
    if (y == null) return null;
    return { x: 0, y: y - TOL, w: 9999, h: TOL * 2 };
  },
});

// ---- Vertical Line ----
registerAdapter({
  tool: "vertical",
  minPoints: 1,
  render(g, d, proj, selected) {
    const x = proj.toX(d.points[0].time);
    if (x == null) return;
    line(g, x, 0, x, proj.height);
    if (selected) handle(g, x, proj.height / 2, d.color);
  },
  hitTest(d, px, py, toX, toY) {
    const x = toX(d.points[0].time);
    if (x != null && Math.abs(x - px) < TOL) {
      return [{ drawing: d, target: "body", distance: Math.abs(x - px) }];
    }
    return [];
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x = toX(d.points[0].time);
    if (x == null) return null;
    return { x: x - TOL, y: 0, w: TOL * 2, h: 9999 };
  },
});

// ---- Cross Line ----
registerAdapter({
  tool: "crossLine",
  minPoints: 1,
  render(g, d, proj, selected) {
    const x = proj.toX(d.points[0].time);
    const y = proj.toY(d.points[0].price);
    if (x == null || y == null) return;
    line(g, x, 0, x, proj.height);
    line(g, 0, y, proj.width, y);
    if (selected) {
      handle(g, x, y, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x = toX(d.points[0].time);
    const y = toY(d.points[0].price);
    if (x != null && Math.abs(x - px) < TOL)
      results.push({ drawing: d, target: "body", distance: Math.abs(x - px) });
    if (y != null && Math.abs(y - py) < TOL)
      results.push({ drawing: d, target: "body", distance: Math.abs(y - py) });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x = toX(d.points[0].time);
    const y = toY(d.points[0].price);
    if (x == null || y == null) return null;
    return { x: x - TOL, y: y - TOL, w: TOL * 2, h: TOL * 2 };
  },
});

// ---- Trend Line ----
registerAdapter({
  tool: "trendline",
  minPoints: 2,
  render(g, d, proj, selected) {
    const pts = d.points;
    const x1 = proj.toX(pts[0].time),
      y1 = proj.toY(pts[0].price);
    const x2 = proj.toX(pts[1].time),
      y2 = proj.toY(pts[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    line(g, x1, y1, x2, y2);
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const segDist = distToSegment(px, py, x1, y1, x2, y2);
    if (segDist < TOL)
      results.push({ drawing: d, target: "segment", distance: segDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2) - TOL,
      y: Math.min(y1, y2) - TOL,
      w: Math.abs(x2 - x1) + TOL * 2,
      h: Math.abs(y2 - y1) + TOL * 2,
    };
  },
});

// ---- Ray (infinite right extension) ----
registerAdapter({
  tool: "ray",
  minPoints: 2,
  render(g, d, proj, selected) {
    const pts = d.points;
    const x1 = proj.toX(pts[0].time),
      y1 = proj.toY(pts[0].price);
    const x2 = proj.toX(pts[1].time),
      y2 = proj.toY(pts[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const dx = x2 - x1,
      dy = y2 - y1;
    const extendX = proj.width + 100;
    const extendY = dy !== 0 ? y1 + (dy / (dx || 1)) * (extendX - x1) : y1;
    line(g, x1, y1, extendX, extendY);
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    // Treat same as trendline for hit testing.
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const segDist = distToSegment(px, py, x1, y1, x2, y2);
    if (segDist < TOL)
      results.push({ drawing: d, target: "segment", distance: segDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    if (x1 == null || y1 == null) return null;
    return { x: x1, y: 0, w: 9999, h: 9999 };
  },
});

// ---- Extended Line (infinite both directions) ----
registerAdapter({
  tool: "extendedLine",
  minPoints: 2,
  render(g, d, proj, selected) {
    const pts = d.points;
    const x1 = proj.toX(pts[0].time),
      y1 = proj.toY(pts[0].price);
    const x2 = proj.toX(pts[1].time),
      y2 = proj.toY(pts[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const dx = x2 - x1,
      dy = y2 - y1;
    const extendX = proj.width + 100;
    const yl = dy !== 0 ? y1 + (dy / (dx || 1)) * (extendX - x1) : y1;
    line(
      g,
      -100,
      dy !== 0 ? y1 + (dy / (dx || 1)) * (-100 - x1) : y1,
      extendX,
      yl,
    );
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const segDist = distToSegment(px, py, x1, y1, x2, y2);
    if (segDist < TOL)
      results.push({ drawing: d, target: "segment", distance: segDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    return { x: 0, y: 0, w: 9999, h: 9999 };
  },
});

// ---- Rectangle ----
registerAdapter({
  tool: "rectangle",
  minPoints: 2,
  render(g, d, proj, selected) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const ox = Math.min(x1, x2),
      oy = Math.min(y1, y2);
    const w = Math.abs(x2 - x1),
      h = Math.abs(y2 - y1);
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.fillStyle = d.fillColor;
      g.globalAlpha = d.opacity ?? 0.3;
      g.fillRect(ox, oy, w, h);
      g.globalAlpha = 1;
      g.restore();
    }
    g.strokeRect(ox, oy, w, h);
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const bodyDist = distToRect(px, py, x1, y1, x2, y2);
    if (bodyDist < TOL)
      results.push({ drawing: d, target: "body", distance: bodyDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  },
});

// ---- Rotated Rectangle ----
registerAdapter({
  tool: "rotatedRect",
  minPoints: 2,
  render(g, d, proj, selected) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y1);
    g.lineTo(x2, y2);
    g.lineTo(x1, y2);
    g.closePath();
    g.stroke();
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const bodyDist = distToRect(px, py, x1, y1, x2, y2);
    if (bodyDist < TOL)
      results.push({ drawing: d, target: "body", distance: bodyDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  },
});

// ---- Circle ----
registerAdapter({
  tool: "circle",
  minPoints: 2,
  render(g, d, proj, selected) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const r = Math.hypot(x2 - x1, y2 - y1);
    g.beginPath();
    g.arc(x1, y1, r, 0, Math.PI * 2);
    g.stroke();
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const r = pointDist(x2, y2, x1, y1);
    const dCenter = pointDist(px, py, x1, y1);
    if (dCenter <= r + TOL) {
      results.push({ drawing: d, target: "body", distance: dCenter });
    }
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    const r = Math.hypot(x2 - x1, y2 - y1);
    return { x: x1 - r, y: y1 - r, w: r * 2, h: r * 2 };
  },
});

// ---- Ellipse ----
registerAdapter({
  tool: "ellipse",
  minPoints: 2,
  render(g, d, proj, selected) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const cx = (x1 + x2) / 2,
      cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2,
      ry = Math.abs(y2 - y1) / 2;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    g.stroke();
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const bodyDist = distToRect(px, py, x1, y1, x2, y2);
    if (bodyDist < TOL)
      results.push({ drawing: d, target: "body", distance: bodyDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  },
});

// ---- Text ----
registerAdapter({
  tool: "text",
  minPoints: 1,
  render(g, d, proj, selected) {
    const x = proj.toX(d.points[0].time),
      y = proj.toY(d.points[0].price);
    if (x == null || y == null) return;
    const txt = d.text || "";
    g.save();
    g.font = "12px var(--font-sans)";
    g.fillStyle = d.color;
    g.fillText(txt, x, y);
    if (selected) handle(g, x, y, d.color);
    g.restore();
  },
  hitTest(d, px, py, toX, toY) {
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
  boundingBox(d, toX, toY) {
    const x = toX(d.points[0].time),
      y = toY(d.points[0].price);
    if (x == null || y == null) return null;
    return { x: x - 20, y: y - 7, w: 40, h: 14 };
  },
});

// ---- Emoji ----
registerAdapter({
  tool: "emoji",
  minPoints: 1,
  render(g, d, proj, selected) {
    const x = proj.toX(d.points[0].time),
      y = proj.toY(d.points[0].price);
    if (x == null || y == null) return;
    g.save();
    g.font = "18px var(--font-sans)";
    g.fillStyle = d.color;
    g.fillText(d.text || "", x - 9, y + 7);
    g.restore();
    if (selected) handle(g, x, y, d.color);
  },
  hitTest(d, px, py, toX, toY) {
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
  boundingBox(d, toX, toY) {
    const x = toX(d.points[0].time),
      y = toY(d.points[0].price);
    if (x == null || y == null) return null;
    return { x: x - 20, y: y - 7, w: 40, h: 14 };
  },
});

// ---- Info Line ----
registerAdapter({
  tool: "infoLine",
  minPoints: 2,
  render(g, d, proj, selected) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    line(g, x1, y1, x2, y2);
    const diff = d.points[1].price - d.points[0].price;
    const pct = d.points[0].price ? (diff / d.points[0].price) * 100 : 0;
    const label = `${diff >= 0 ? "+" : ""}${diff.toFixed(4)} (${pct.toFixed(2)}%)`;
    const cx = (x1 + x2) / 2,
      cy = (y1 + y2) / 2;
    chip(g, label, cx - 40, cy - 9, d.color);
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const segDist = distToSegment(px, py, x1, y1, x2, y2);
    if (segDist < TOL)
      results.push({ drawing: d, target: "segment", distance: segDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2) - 80,
      y: Math.min(y1, y2) - 18,
      w: Math.abs(x2 - x1) + 160,
      h: Math.abs(y2 - y1) + 36,
    };
  },
});

// ---- Channel ----
registerAdapter({
  tool: "channel",
  minPoints: 2,
  render(g, d, proj, selected) {
    const x1 = proj.toX(d.points[0].time),
      y1 = proj.toY(d.points[0].price);
    const x2 = proj.toX(d.points[1].time),
      y2 = proj.toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const dx = x2 - x1,
      dy = y2 - y1;
    const span =
      d.points.length >= 3 ? d.points[2].price - d.points[0].price : 50;
    const t = span / Math.hypot(dx, dy);
    const off = t * Math.hypot(dy, dx);
    const y1b = y2 + off,
      y2b = y1 + off;
    line(g, x1, y1, x2, y2);
    line(g, x1, y1b, x2, y2b);
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const segDist = distToSegment(px, py, x1, y1, x2, y2);
    if (segDist < TOL)
      results.push({ drawing: d, target: "segment", distance: segDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    if (x1 == null || y1 == null) return null;
    return { x: x1 - 10, y: 0, w: 9999, h: 9999 };
  },
});

// ---- Remaining tools with proper render implementations ----

// Shared projection helper.
function project(
  pt: Pt,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
) {
  const x = toX(pt.time);
  const y = toY(pt.price);
  return x != null && y != null ? { x, y } : null;
}

const BULL = "#26a69a";
const BEAR = "#ef5350";

// ---- Fibonacci -------
registerAdapter({
  tool: "fib",
  minPoints: 2,
  render(g, d, proj, selected) {
    const pts = d.points;
    const x1 = proj.toX(pts[0].time),
      y1 = proj.toY(pts[0].price);
    const x2 = proj.toX(pts[1].time),
      y2 = proj.toY(pts[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return;
    const hi = pts[0].price,
      lo = pts[1].price;
    g.save();
    g.font = "10px var(--font-mono)";
    const left = Math.min(x1, x2),
      right = Math.max(x1, x2);
    for (const lvl of FIB_LEVELS) {
      const price = hi + (lo - hi) * lvl;
      const y = proj.toY(price);
      if (y == null) continue;
      g.globalAlpha = 0.7;
      line(g, left, y, right, y);
      g.globalAlpha = 1;
      g.fillStyle = d.color;
      g.fillText(
        `${(lvl * 100).toFixed(1)}%  ${price.toFixed(4)}`,
        right + 4,
        y + 3,
      );
    }
    g.restore();
    if (selected) {
      handle(g, x1, y1, d.color);
      handle(g, x2, y2, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return results;
    if (pointDist(px, py, x1, y1) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p1",
        distance: pointDist(px, py, x1, y1),
      });
    if (pointDist(px, py, x2, y2) <= HANDLE_RADIUS)
      results.push({
        drawing: d,
        target: "p2",
        distance: pointDist(px, py, x2, y2),
      });
    const bodyDist = distToRect(px, py, x1, y1, x2, y2);
    if (bodyDist < TOL)
      results.push({ drawing: d, target: "body", distance: bodyDist });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const x1 = toX(d.points[0].time),
      y1 = toY(d.points[0].price);
    const x2 = toX(d.points[1].time),
      y2 = toY(d.points[1].price);
    if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  },
});

// ---- Triangle -------
registerAdapter({
  tool: "triangle",
  minPoints: 3,
  render(g, d, proj, selected) {
    const pts = d.points.slice(0, 3);
    const projPts = pts.map((p) => project(p, proj.toX, proj.toY));
    if (projPts.some((p) => !p)) return;
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++)
      g.lineTo(projPts[i]!.x, projPts[i]!.y);
    g.closePath();
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.globalAlpha = d.opacity ?? 0.15;
      g.fillStyle = d.fillColor;
      g.fill();
      g.restore();
    }
    g.stroke();
    if (selected) projPts.forEach((p) => handle(g, p!.x, p!.y, d.color));
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const projected = d.points.map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));
    for (let i = 0; i < projected.length; i++) {
      const pt = projected[i];
      if (pt.x == null || pt.y == null) continue;
      const dist = pointDist(px, py, pt.x, pt.y);
      if (dist <= HANDLE_RADIUS) {
        results.push({
          drawing: d,
          target: i === 0 ? "p1" : i === projected.length - 1 ? "p2" : "body",
          distance: dist,
        });
      }
    }
    // Check each segment.
    for (let j = 0; j < projected.length - 1; j++) {
      const a = projected[j],
        b = projected[j + 1];
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const segDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
      if (segDist < TOL * 1.5)
        results.push({ drawing: d, target: "segment", distance: segDist });
    }
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const xs = d.points
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = d.points
      .map((pt) => toY(pt.price))
      .filter((v): v is number => v != null);
    if (xs.length === 0 || ys.length === 0) return null;
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
});

// ---- Polyline -------
registerAdapter({
  tool: "polyline",
  minPoints: 2,
  render(g, d, proj, selected) {
    const pts = d.points;
    if (pts.length < 2) return;
    const projPts = pts.map((p) => project(p, proj.toX, proj.toY));
    if (projPts.some((p) => !p)) return;
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++) {
      if (projPts[i]) g.lineTo(projPts[i]!.x, projPts[i]!.y);
    }
    g.stroke();
    if (selected)
      projPts.forEach((p) => {
        if (p) handle(g, p.x, p.y, d.color);
      });
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const projected = d.points.map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));
    for (let i = 0; i < projected.length; i++) {
      const pt = projected[i];
      if (pt.x == null || pt.y == null) continue;
      const dist = pointDist(px, py, pt.x, pt.y);
      if (dist <= HANDLE_RADIUS)
        results.push({
          drawing: d,
          target: i === 0 ? "p1" : i === projected.length - 1 ? "p2" : "body",
          distance: dist,
        });
    }
    for (let j = 0; j < projected.length - 1; j++) {
      const a = projected[j],
        b = projected[j + 1];
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const segDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
      if (segDist < TOL * 1.5)
        results.push({ drawing: d, target: "segment", distance: segDist });
    }
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const xs = d.points
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = d.points
      .map((pt) => toY(pt.price))
      .filter((v): v is number => v != null);
    if (xs.length === 0 || ys.length === 0) return null;
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
});

// ---- Curve -------
registerAdapter({
  tool: "curve",
  minPoints: 3,
  render(g, d, proj, selected) {
    const pts = d.points;
    if (pts.length < 3) return;
    const projPts = pts
      .map((p) => project(p, proj.toX, proj.toY))
      .filter((p): p is { x: number; y: number } => p != null);
    if (projPts.length < 3) return;
    g.beginPath();
    g.moveTo(projPts[0].x, projPts[0].y);
    for (let i = 1; i < projPts.length - 1; i++) {
      const cp2x = (projPts[i].x + projPts[i + 1].x) / 2;
      const cp2y = (projPts[i].y + projPts[i + 1].y) / 2;
      g.quadraticCurveTo(projPts[i].x, projPts[i].y, cp2x, cp2y);
    }
    g.stroke();
    if (selected) projPts.forEach((p) => handle(g, p.x, p.y, d.color));
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const projected = d.points.map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));
    for (let i = 0; i < projected.length; i++) {
      const pt = projected[i];
      if (pt.x == null || pt.y == null) continue;
      const dist = pointDist(px, py, pt.x, pt.y);
      if (dist <= HANDLE_RADIUS)
        results.push({
          drawing: d,
          target: i === 0 ? "p1" : i === projected.length - 1 ? "p2" : "body",
          distance: dist,
        });
    }
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const xs = d.points
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = d.points
      .map((pt) => toY(pt.price))
      .filter((v): v is number => v != null);
    if (xs.length === 0 || ys.length === 0) return null;
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
});

// ---- Path (closed polyline) -------
registerAdapter({
  tool: "path",
  minPoints: 2,
  render(g, d, proj, selected) {
    const pts = d.points;
    if (pts.length < 2) return;
    const projPts = pts.map((p) => project(p, proj.toX, proj.toY));
    if (projPts.some((p) => !p)) return;
    g.beginPath();
    g.moveTo(projPts[0]!.x, projPts[0]!.y);
    for (let i = 1; i < projPts.length; i++) {
      if (projPts[i]) g.lineTo(projPts[i]!.x, projPts[i]!.y);
    }
    g.closePath();
    if (d.fillColor && d.fillColor !== "none") {
      g.save();
      g.globalAlpha = d.opacity ?? 0.15;
      g.fillStyle = d.fillColor;
      g.fill();
      g.restore();
    }
    g.stroke();
    if (selected)
      projPts.forEach((p) => {
        if (p) handle(g, p.x, p.y, d.color);
      });
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const projected = d.points.map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));
    for (let i = 0; i < projected.length; i++) {
      const pt = projected[i];
      if (pt.x == null || pt.y == null) continue;
      const dist = pointDist(px, py, pt.x, pt.y);
      if (dist <= HANDLE_RADIUS)
        results.push({
          drawing: d,
          target: i === 0 ? "p1" : i === projected.length - 1 ? "p2" : "body",
          distance: dist,
        });
    }
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const xs = d.points
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = d.points
      .map((pt) => toY(pt.price))
      .filter((v): v is number => v != null);
    if (xs.length === 0 || ys.length === 0) return null;
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
});

// ---- Brush (freehand) -------
registerAdapter({
  tool: "brush",
  minPoints: 2,
  render(g, d, proj, selected) {
    const pts = d.points;
    if (pts.length < 2) return;
    g.beginPath();
    const p0 = project(pts[0], proj.toX, proj.toY);
    if (!p0) return;
    g.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = project(pts[i], proj.toX, proj.toY);
      const b = project(pts[i + 1], proj.toX, proj.toY);
      if (!a || !b) continue;
      g.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    const last = project(pts[pts.length - 1], proj.toX, proj.toY);
    if (last) g.lineTo(last.x, last.y);
    g.stroke();
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const projected = d.points.map((pt) => ({
      x: toX(pt.time),
      y: toY(pt.price),
    }));
    for (let j = 0; j < projected.length - 1; j++) {
      const a = projected[j],
        b = projected[j + 1];
      if (a.x == null || a.y == null || b.x == null || b.y == null) continue;
      const segDist = distToSegment(px, py, a.x, a.y, b.x, b.y);
      if (segDist < TOL)
        results.push({ drawing: d, target: "segment", distance: segDist });
    }
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const xs = d.points
      .map((pt) => toX(pt.time))
      .filter((v): v is number => v != null);
    const ys = d.points
      .map((pt) => toY(pt.price))
      .filter((v): v is number => v != null);
    if (xs.length === 0 || ys.length === 0) return null;
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  },
});

// ---- Long Position -------
registerAdapter({
  tool: "long",
  minPoints: 1,
  render(g, d, proj, selected) {
    const entry = d.points[0].price,
      stop = d.stop ?? entry,
      target = d.target ?? entry;
    const xL = proj.toX(d.points[0].time);
    const xR = d.points[1] ? proj.toX(d.points[1].time) : null;
    const yE = proj.toY(entry),
      yS = proj.toY(stop),
      yT = proj.toY(target);
    if (xL == null || yE == null || yS == null || yT == null) return;
    const right = xR ?? xL + 130;
    g.save();
    g.globalAlpha = 0.14;
    g.fillStyle = BULL;
    g.fillRect(
      Math.min(xL, right),
      Math.min(yE, yT),
      Math.abs(right - xL),
      Math.abs(yT - yE),
    );
    g.globalAlpha = 0.14;
    g.fillStyle = BEAR;
    g.fillRect(
      Math.min(xL, right),
      Math.min(yE, yS),
      Math.abs(right - xL),
      Math.abs(yS - yE),
    );
    g.restore();
    g.strokeStyle = BULL;
    line(g, xL, yE, right, yE);
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = BEAR;
    line(g, xL, yS, right, yS);
    g.restore();
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = BULL;
    line(g, xL, yT, right, yT);
    g.restore();
    if (selected) {
      handle(g, xL, yE, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const xL = toX(d.points[0].time),
      yE = toY(d.points[0].price);
    if (yE != null && Math.abs(yE - py) < TOL)
      results.push({ drawing: d, target: "body", distance: Math.abs(yE - py) });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const xL = toX(d.points[0].time),
      yE = toY(d.points[0].price);
    if (xL == null || yE == null) return null;
    const xR = d.points[1] ? toX(d.points[1].time) : xL + 130;
    const right = xR ?? xL + 130;
    return {
      x: Math.min(xL, right),
      y: Math.min(yE, yE) - 50,
      w: Math.abs(right - xL),
      h: 100,
    };
  },
});

// ---- Short Position -------
registerAdapter({
  tool: "short",
  minPoints: 1,
  render(g, d, proj, selected) {
    const entry = d.points[0].price,
      stop = d.stop ?? entry,
      target = d.target ?? entry;
    const xL = proj.toX(d.points[0].time);
    const xR = d.points[1] ? proj.toX(d.points[1].time) : null;
    const yE = proj.toY(entry),
      yS = proj.toY(stop),
      yT = proj.toY(target);
    if (xL == null || yE == null || yS == null || yT == null) return;
    const right = xR ?? xL + 130;
    g.save();
    g.globalAlpha = 0.14;
    g.fillStyle = BEAR;
    g.fillRect(
      Math.min(xL, right),
      Math.min(yE, yT),
      Math.abs(right - xL),
      Math.abs(yT - yE),
    );
    g.globalAlpha = 0.14;
    g.fillStyle = BULL;
    g.fillRect(
      Math.min(xL, right),
      Math.min(yE, yS),
      Math.abs(right - xL),
      Math.abs(yS - yE),
    );
    g.restore();
    g.strokeStyle = BEAR;
    line(g, xL, yE, right, yE);
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = BULL;
    line(g, xL, yS, right, yS);
    g.restore();
    g.save();
    g.setLineDash([4, 3]);
    g.strokeStyle = BEAR;
    line(g, xL, yT, right, yT);
    g.restore();
    if (selected) {
      handle(g, xL, yE, d.color);
    }
  },
  hitTest(d, px, py, toX, toY) {
    const results: HitResult[] = [];
    const xL = toX(d.points[0].time),
      yE = toY(d.points[0].price);
    if (yE != null && Math.abs(yE - py) < TOL)
      results.push({ drawing: d, target: "body", distance: Math.abs(yE - py) });
    return results;
  },
  movePoints: defaultMovePoints,
  boundingBox(d, toX, toY) {
    const xL = toX(d.points[0].time),
      yE = toY(d.points[0].price);
    if (xL == null || yE == null) return null;
    const xR = d.points[1] ? toX(d.points[1].time) : xL + 130;
    const right = xR ?? xL + 130;
    return {
      x: Math.min(xL, right),
      y: Math.min(yE, yE) - 50,
      w: Math.abs(right - xL),
      h: 100,
    };
  },
});
