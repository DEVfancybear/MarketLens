/**
 * DrawingRenderer — pure canvas rendering for every drawing type.
 *
 * All geometry is stored in (time, price) space; the projector converts to
 * pixels so drawings stay pinned through zoom / pan / resize / timeframe change.
 * No React, no state — just draw calls, so it is trivially memo-friendly and
 * fast enough for 1000+ objects.
 */
import { FIB_LEVELS, type Drawing, type Point, type LineStyle } from "@/types";

export interface Projector {
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  width: number;
  height: number;
}

const BULL = "#26a69a";
const BEAR = "#ef5350";

/** Apply lineStyle to the canvas context before stroking. */
function applyStyle(g: CanvasRenderingContext2D, style: LineStyle | undefined) {
  if (style === "dashed") g.setLineDash([6, 3]);
  else if (style === "dotted") g.setLineDash([2, 3]);
  else g.setLineDash([]);
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
  g.font = "10px var(--font-sans)";
  const w = g.measureText(text).width + 8;
  g.fillStyle = color;
  g.fillRect(x, y - 7, w, 14);
  g.fillStyle = "#fff";
  g.textBaseline = "middle";
  g.fillText(text, x + 4, y + 0.5);
  g.restore();
}

/** Render a single drawing. Caller sets strokeStyle/lineWidth defaults. */
export function renderDrawing(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
  selected: boolean,
) {
  const { toX, toY, width, height } = proj;
  g.strokeStyle = d.color;
  g.fillStyle = d.color;
  g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.5 : 1);
  applyStyle(g, d.lineStyle);
  const pts = d.points;

  switch (d.tool) {
    // ---- single-point horizontal tools ----
    case "horizontal":
    case "horizRay": {
      const y = toY(pts[0].price);
      if (y == null) return;
      const xStart = d.tool === "horizRay" ? (toX(pts[0].time) ?? 0) : 0;
      const xEnd = d.tool === "horizRay" ? width : width;
      line(g, xStart, y, xEnd, y);
      chip(g, pts[0].price.toFixed(4), 2, y - 9, d.color);
      if (selected) handle(g, xStart, y, d.color);
      return;
    }

    // ---- single-point vertical tools ----
    case "vertical": {
      const x = toX(pts[0].time);
      if (x == null) return;
      line(g, x, 0, x, height);
      if (selected) handle(g, x, height / 2, d.color);
      return;
    }

    // ---- cross line (single-point, full-chart crosshair) ----
    case "crossLine": {
      const x = toX(pts[0].time);
      const y = toY(pts[0].price);
      if (x == null || y == null) return;
      g.save();
      g.globalAlpha = 0.6;
      line(g, x, 0, x, height);
      line(g, 0, y, width, y);
      g.restore();
      if (selected) {
        handle(g, x, y, d.color);
      }
      return;
    }

    // ---- info line (measurement between two points) ----
    case "infoLine": {
      if (pts.length < 2) {
        const x1 = toX(pts[0].time);
        const y1 = toY(pts[0].price);
        if (x1 != null && y1 != null && selected) handle(g, x1, y1, d.color);
        return;
      }
      const ax = toX(pts[0].time);
      const ay = toY(pts[0].price);
      const bx = toX(pts[1].time);
      const by = toY(pts[1].price);
      if (ax == null || ay == null || bx == null || by == null) return;
      renderInfoLine(g, ax, ay, bx, by, pts[0], pts[1], d, selected);
      return;
    }

    // ---- text / emoji ----
    case "text":
    case "emoji": {
      const x = toX(pts[0].time);
      const y = toY(pts[0].price);
      if (x == null || y == null) return;
      g.save();
      g.font =
        d.tool === "emoji" ? "20px var(--font-sans)" : "13px var(--font-sans)";
      g.fillStyle = d.color;
      g.textBaseline = "middle";
      g.fillText(d.text || "", x, y);
      g.restore();
      if (selected) handle(g, x, y, d.color);
      return;
    }

    case "brush": {
      if (pts.length < 2) return;
      g.beginPath();
      const p0 = project(pts[0], toX, toY);
      if (!p0) return;
      g.moveTo(p0.x, p0.y);
      for (let i = 1; i < pts.length - 1; i++) {
        const a = project(pts[i], toX, toY);
        const b = project(pts[i + 1], toX, toY);
        if (!a || !b) continue;
        g.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      const last = project(pts[pts.length - 1], toX, toY);
      if (last) g.lineTo(last.x, last.y);
      g.stroke();
      return;
    }

    case "long":
    case "short":
      return renderPosition(g, d, proj, selected);
  }

  // ---- Two-point tools ----
  if (pts.length < 2) {
    const x = toX(pts[0].time);
    const y = toY(pts[0].price);
    if (x != null && y != null && selected) handle(g, x, y, d.color);
    return;
  }
  const x1 = toX(pts[0].time);
  const y1 = toY(pts[0].price);
  const x2 = toX(pts[1].time);
  const y2 = toY(pts[1].price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;

  switch (d.tool) {
    case "trendline": {
      line(g, x1, y1, x2, y2);
      if (selected) {
        handle(g, x1, y1, d.color);
        handle(g, x2, y2, d.color);
      }
      return;
    }
    case "ray": {
      // Ray: full line from x1,y1 through x2,y2 extending infinitely right.
      const dx = x2 - x1;
      const dy = y2 - y1;
      const extendX = dx === 0 ? x1 : width;
      const extendY = dx === 0 ? y1 : y1 + dy * ((width - x1) / dx);
      line(g, x1, y1, extendX, extendY);
      if (selected) {
        handle(g, x1, y1, d.color);
        handle(g, x2, y2, d.color);
      }
      return;
    }
    case "extendedLine": {
      // Extended line: full chart width through both points.
      const dx2 = x2 - x1;
      const dy2 = y2 - y1;
      if (Math.abs(dx2) < 0.001) {
        line(g, x1, 0, x1, height);
      } else {
        const yLeft = y1 - dy2 * (x1 / dx2);
        const yRight = y1 + dy2 * ((width - x1) / dx2);
        line(g, 0, yLeft, width, yRight);
      }
      if (selected) {
        handle(g, x1, y1, d.color);
        handle(g, x2, y2, d.color);
      }
      return;
    }
    case "rectangle": {
      renderRect(g, x1, y1, x2, y2, d, selected);
      return;
    }
    case "rotatedRect": {
      renderRotatedRect(g, pts, toX, toY, d, selected);
      return;
    }
    case "circle": {
      const r = circleRadius(pts, toX, toY);
      if (r == null) return;
      renderCircle(g, x1, y1, r, d, selected);
      return;
    }
    case "ellipse": {
      renderEllipse(g, pts, toX, toY, d, selected);
      return;
    }
    case "triangle": {
      renderPolygon(g, pts.slice(0, 3), toX, toY, d, selected);
      return;
    }
    case "polyline":
    case "path": {
      if (pts.length < 2) {
        renderSinglePoint(g, pts[0], toX, toY, d, selected);
        return;
      }
      renderPolyline(g, pts, toX, toY, d, selected, d.tool === "path");
      return;
    }
    case "curve": {
      if (pts.length < 3) {
        renderSinglePoint(g, pts[0], toX, toY, d, selected);
        return;
      }
      renderCurve(g, pts, toX, toY, d, selected);
      return;
    }
    case "channel": {
      line(g, x1, y1, x2, y2);
      const off = pts[2] ? channelOffset(pts, toY) : 0;
      const y1b = toY(pts[0].price + off);
      const y2b = toY(pts[1].price + off);
      if (y1b != null && y2b != null) {
        line(g, x1, y1b, x2, y2b);
        g.save();
        g.globalAlpha = 0.08;
        g.beginPath();
        g.moveTo(x1, y1);
        g.lineTo(x2, y2);
        g.lineTo(x2, y2b);
        g.lineTo(x1, y1b);
        g.closePath();
        g.fill();
        g.restore();
      }
      if (selected) {
        handle(g, x1, y1, d.color);
        handle(g, x2, y2, d.color);
        if (y1b != null) handle(g, x1, y1b, d.color);
      }
      return;
    }
    case "fib": {
      const hi = pts[0].price;
      const lo = pts[1].price;
      g.save();
      g.font = "10px var(--font-mono)";
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      for (const lvl of FIB_LEVELS) {
        const price = hi + (lo - hi) * lvl;
        const y = toY(price);
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
      return;
    }
  }
}

// ---- shape renderers ----

function renderRect(
  g: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  d: Drawing,
  selected: boolean,
) {
  const ox = Math.min(x1, x2),
    oy = Math.min(y1, y2);
  const w = Math.abs(x2 - x1),
    h = Math.abs(y2 - y1);
  if (d.fillColor) {
    g.save();
    g.globalAlpha = d.opacity ?? 0.15;
    g.fillStyle = d.fillColor;
    g.fillRect(ox, oy, w, h);
    g.restore();
  } else {
    g.save();
    g.globalAlpha = 0.12;
    g.fillStyle = d.color;
    g.fillRect(ox, oy, w, h);
    g.restore();
  }
  g.strokeRect(ox, oy, w, h);
  if (selected) {
    handle(g, x1, y1, d.color);
    handle(g, x2, y2, d.color);
  }
}

function renderRotatedRect(
  g: CanvasRenderingContext2D,
  pts: Point[],
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
  d: Drawing,
  selected: boolean,
) {
  if (pts.length < 3) return;
  const corners = pts.slice(0, 4).map((p) => project(p, toX, toY));
  if (corners.some((c) => !c)) return;
  const [a, b, c, e] = corners;
  g.beginPath();
  g.moveTo(a!.x, a!.y);
  g.lineTo(b!.x, b!.y);
  g.lineTo(c!.x, c!.y);
  g.lineTo(e!.x, e!.y);
  g.closePath();
  if (d.fillColor) {
    g.save();
    g.globalAlpha = d.opacity ?? 0.15;
    g.fillStyle = d.fillColor;
    g.fill();
    g.restore();
  } else {
    g.save();
    g.globalAlpha = 0.12;
    g.fillStyle = d.color;
    g.fill();
    g.restore();
  }
  g.stroke();
  if (selected) corners.forEach((c2) => handle(g, c2!.x, c2!.y, d.color));
}

function circleRadius(
  pts: Point[],
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
): number | null {
  if (pts.length < 2) return 20; // default radius if single point
  const c = project(pts[0], toX, toY);
  const e = project(pts[1], toX, toY);
  if (!c || !e) return null;
  return Math.hypot(e.x - c.x, e.y - c.y);
}

function renderCircle(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  d: Drawing,
  selected: boolean,
) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  if (d.fillColor) {
    g.save();
    g.globalAlpha = d.opacity ?? 0.15;
    g.fillStyle = d.fillColor;
    g.fill();
    g.restore();
  }
  g.stroke();
  if (selected) {
    handle(g, cx, cy, d.color);
    handle(g, cx + r, cy, d.color);
  }
}

function renderEllipse(
  g: CanvasRenderingContext2D,
  pts: Point[],
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
  d: Drawing,
  selected: boolean,
) {
  if (pts.length < 3) return;
  const c = project(pts[0], toX, toY);
  const rxPt = project(pts[1], toX, toY);
  const ryPt = project(pts[2], toX, toY);
  if (!c || !rxPt || !ryPt) return;
  const rx = Math.abs(rxPt.x - c.x);
  const ry = Math.abs(ryPt.y - c.y);
  g.save();
  g.beginPath();
  g.ellipse(c.x, c.y, rx, ry, 0, 0, Math.PI * 2);
  if (d.fillColor) {
    g.globalAlpha = d.opacity ?? 0.15;
    g.fillStyle = d.fillColor;
    g.fill();
  }
  g.restore();
  g.stroke();
  if (selected) {
    handle(g, c.x, c.y, d.color);
    handle(g, rxPt.x, ryPt.y, d.color);
  }
}

function renderPolygon(
  g: CanvasRenderingContext2D,
  pts: Point[],
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
  d: Drawing,
  selected: boolean,
) {
  const proj = pts.map((p) => project(p, toX, toY));
  if (proj.some((p2) => !p2)) return;
  g.beginPath();
  g.moveTo(proj[0]!.x, proj[0]!.y);
  for (let i = 1; i < proj.length; i++) g.lineTo(proj[i]!.x, proj[i]!.y);
  g.closePath();
  if (d.fillColor) {
    g.save();
    g.globalAlpha = d.opacity ?? 0.15;
    g.fillStyle = d.fillColor;
    g.fill();
    g.restore();
  }
  g.stroke();
  if (selected) proj.forEach((p2) => handle(g, p2!.x, p2!.y, d.color));
}

function renderPolyline(
  g: CanvasRenderingContext2D,
  pts: Point[],
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
  d: Drawing,
  selected: boolean,
  closed: boolean,
) {
  const proj = pts.map((p) => project(p, toX, toY));
  if (proj.length < 2) return;
  g.beginPath();
  g.moveTo(proj[0]!.x, proj[0]!.y);
  for (let i = 1; i < proj.length; i++) {
    const p2 = proj[i];
    if (p2) g.lineTo(p2.x, p2.y);
  }
  if (closed) g.closePath();
  if (closed && d.fillColor) {
    g.save();
    g.globalAlpha = d.opacity ?? 0.15;
    g.fillStyle = d.fillColor;
    g.fill();
    g.restore();
  }
  g.stroke();
  if (selected)
    proj.forEach((p2) => {
      if (p2) handle(g, p2.x, p2.y, d.color);
    });
}

function renderCurve(
  g: CanvasRenderingContext2D,
  pts: Point[],
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
  d: Drawing,
  selected: boolean,
) {
  const proj = pts.map((p) => project(p, toX, toY));
  const valid = proj.filter((p2): p2 is { x: number; y: number } => p2 != null);
  if (valid.length < 3) return;
  g.beginPath();
  g.moveTo(valid[0].x, valid[0].y);
  // Bezier curve through points using midpoints as control points.
  for (let i = 1; i < valid.length - 1; i++) {
    const cp1x = (valid[i].x + valid[i - 1].x) / 2;
    const cp1y = (valid[i].y + valid[i - 1].y) / 2;
    const cp2x = (valid[i].x + valid[i + 1].x) / 2;
    const cp2y = (valid[i].y + valid[i + 1].y) / 2;
    g.quadraticCurveTo(valid[i].x, valid[i].y, cp2x, cp2y);
  }
  g.stroke();
  if (selected) valid.forEach((p2) => handle(g, p2.x, p2.y, d.color));
}

function renderSinglePoint(
  g: CanvasRenderingContext2D,
  pt: Point,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
  d: Drawing,
  selected: boolean,
) {
  if (!selected) return;
  const x = toX(pt.time),
    y = toY(pt.price);
  if (x != null && y != null) handle(g, x, y, d.color);
}

// ---- info line renderer ----
function renderInfoLine(
  g: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  a: Point,
  b: Point,
  d: Drawing,
  selected: boolean,
) {
  const up = b.price >= a.price;
  const color = up ? BULL : BEAR;

  // Line between the two points.
  g.save();
  g.strokeStyle = color;
  line(g, ax, ay, bx, by);

  // Measurement box at midpoint.
  const diff = b.price - a.price;
  const pct = (diff / a.price) * 100;
  const bars = Math.round(Math.abs(b.time - a.time) / 60);
  const min = Math.round(Math.abs(b.time - a.time) / 60);
  const lines = [
    `${diff >= 0 ? "+" : ""}${diff.toFixed(4)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`,
    `${bars} bars, ${formatDuration2(min)}`,
  ];
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  g.font = "11px var(--font-sans)";
  const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 14;
  g.fillStyle = color;
  g.fillRect(cx - tw / 2, cy - 18, tw, 34);
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => g.fillText(l, cx, cy - 6 + i * 14));
  g.restore();

  if (selected) {
    handle(g, ax, ay, d.color);
    handle(g, bx, by, d.color);
  }
}

/** Long / short position risk-reward box. */
function renderPosition(
  g: CanvasRenderingContext2D,
  d: Drawing,
  proj: Projector,
  selected: boolean,
) {
  const { toX, toY } = proj;
  const entry = d.points[0].price;
  const stop = d.stop ?? entry;
  const target = d.target ?? entry;
  const xL = toX(d.points[0].time);
  const xR = d.points[1] ? toX(d.points[1].time) : null;
  const yE = toY(entry);
  const yS = toY(stop);
  const yT = toY(target);
  if (xL == null || yE == null || yS == null || yT == null) return;
  const right = xR == null ? xL + 130 : xR;
  const x = Math.min(xL, right);
  const w = Math.abs(right - xL);

  g.save();
  g.globalAlpha = 0.14;
  g.fillStyle = BULL;
  g.fillRect(x, Math.min(yE, yT), w, Math.abs(yT - yE));
  g.fillStyle = BEAR;
  g.fillRect(x, Math.min(yE, yS), w, Math.abs(yS - yE));
  g.restore();

  g.lineWidth = 1;
  applyStyle(g, d.lineStyle);
  g.strokeStyle = BULL;
  line(g, x, yT, x + w, yT);
  g.strokeStyle = BEAR;
  line(g, x, yS, x + w, yS);
  g.strokeStyle = "#b2b5be";
  line(g, x, yE, x + w, yE);

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = risk > 0 ? reward / risk : 0;
  const riskPct = (risk / entry) * 100;
  const rewardPct = (reward / entry) * 100;
  chip(
    g,
    `TP ${target.toFixed(4)}  +${rewardPct.toFixed(2)}%`,
    x,
    yT - 9,
    BULL,
  );
  chip(g, `SL ${stop.toFixed(4)}  -${riskPct.toFixed(2)}%`, x, yS + 9, BEAR);
  chip(
    g,
    `${d.tool === "long" ? "LONG" : "SHORT"}  RR ${rr.toFixed(2)}`,
    x,
    yE,
    "#2962ff",
  );

  if (selected) {
    handle(g, x, yE, d.color);
    handle(g, x + w, yT, d.color);
    handle(g, x + w, yS, d.color);
  }
}

// ---- transient measure overlay ----
export function renderMeasure(
  g: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  proj: Projector,
  bars: number,
) {
  const { toX, toY } = proj;
  const ax = toX(a.time);
  const ay = toY(a.price);
  const bx = toX(b.time);
  const by = toY(b.price);
  if (ax == null || ay == null || bx == null || by == null) return;
  renderInfoLine(
    g,
    ax,
    ay,
    bx,
    by,
    a,
    b,
    {
      tool: "infoLine",
      color: b.price >= a.price ? BULL : BEAR,
      lineWidth: 1,
      points: [a, b],
    } as Drawing,
    false,
  );
}

// ---- helpers ----
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

function project(
  p: Point,
  toX: (t: number) => number | null,
  toY: (v: number) => number | null,
) {
  const x = toX(p.time);
  const y = toY(p.price);
  return x == null || y == null ? null : { x, y };
}

function channelOffset(
  pts: Point[],
  _toY: (v: number) => number | null,
): number {
  const [a, b, c] = pts;
  if (!c) return 0;
  const span = b.time - a.time || 1;
  const t = (c.time - a.time) / span;
  const priceOnLine = a.price + (b.price - a.price) * t;
  return c.price - priceOnLine;
}

function formatDuration2(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}
