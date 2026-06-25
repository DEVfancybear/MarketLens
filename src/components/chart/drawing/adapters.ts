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
import type { Drawing, Point, DrawingTool } from "@/types";
import type { HitResult, HitTestProjector } from "./drawingHitTest";
import type { Projector } from "./drawingRenderer";
import {
  type ToolAdapter,
  registerAdapter,
  defaultMovePoints,
  HANDLE_RADIUS,
  TOL,
  pointDist,
  distToSegment,
  distToRect,
} from "./ToolAdapter";

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

// ---- Stub adapters for remaining tools (full implementations deferred) ----
const stubAdapter = (
  tool: DrawingTool,
  minPoints: number,
  render: ToolAdapter["render"],
): ToolAdapter => ({
  tool,
  minPoints,
  render,
  hitTest(d, px, py, toX, toY) {
    // Default: bounding box of all projected points.
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
        const target =
          i === 0
            ? ("p1" as const)
            : i === projected.length - 1
              ? ("p2" as const)
              : ("body" as const);
        results.push({ drawing: d, target, distance: dist });
      }
    }
    if (projected.length === 2) {
      const x1 = projected[0].x!,
        y1 = projected[0].y!;
      const x2 = projected[1].x!,
        y2 = projected[1].y!;
      const bodyDist = distToRect(px, py, x1, y1, x2, y2);
      if (bodyDist < TOL)
        results.push({ drawing: d, target: "body", distance: bodyDist });
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

registerAdapter(stubAdapter("fib", 2, (_g, _d, _p, _s) => {}));
registerAdapter(stubAdapter("triangle", 3, (_g, _d, _p, _s) => {}));
registerAdapter(stubAdapter("polyline", 2, (_g, _d, _p, _s) => {}));
registerAdapter(stubAdapter("curve", 2, (_g, _d, _p, _s) => {}));
registerAdapter(stubAdapter("path", 2, (_g, _d, _p, _s) => {}));
registerAdapter(stubAdapter("brush", 2, (_g, _d, _p, _s) => {}));
registerAdapter(stubAdapter("long", 1, (_g, _d, _p, _s) => {}));
registerAdapter(stubAdapter("short", 1, (_g, _d, _p, _s) => {}));
