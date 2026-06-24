/**
 * DrawingRenderer — pure canvas rendering for every drawing type.
 *
 * All geometry is stored in (time, price) space; the projector converts to
 * pixels so drawings stay pinned through zoom / pan / resize / timeframe change.
 * No React, no state — just draw calls, so it is trivially memo-friendly and
 * fast enough for 1000+ objects.
 */
import { FIB_LEVELS, type Drawing, type Point } from '@/types';

export interface Projector {
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  width: number;
  height: number;
}

const BULL = '#26a69a';
const BEAR = '#ef5350';

function handle(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  g.save();
  g.fillStyle = '#fff';
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, 4, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}

function chip(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  g.save();
  g.font = '10px var(--font-sans)';
  const w = g.measureText(text).width + 8;
  g.fillStyle = color;
  g.fillRect(x, y - 7, w, 14);
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
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
  const pts = d.points;

  switch (d.tool) {
    case 'horizontal': {
      const y = toY(pts[0].price);
      if (y == null) return;
      line(g, 0, y, width, y);
      chip(g, pts[0].price.toFixed(4), 2, y - 9, d.color);
      if (selected) handle(g, width / 2, y, d.color);
      return;
    }
    case 'vertical': {
      const x = toX(pts[0].time);
      if (x == null) return;
      line(g, x, 0, x, height);
      if (selected) handle(g, x, height / 2, d.color);
      return;
    }
    case 'text':
    case 'emoji': {
      const x = toX(pts[0].time);
      const y = toY(pts[0].price);
      if (x == null || y == null) return;
      g.save();
      g.font = d.tool === 'emoji' ? '20px var(--font-sans)' : '13px var(--font-sans)';
      g.fillStyle = d.color;
      g.textBaseline = 'middle';
      g.fillText(d.text || '', x, y);
      g.restore();
      if (selected) handle(g, x, y, d.color);
      return;
    }
    case 'brush': {
      if (pts.length < 2) return;
      g.beginPath();
      const p0 = project(pts[0], toX, toY);
      if (!p0) return;
      g.moveTo(p0.x, p0.y);
      // Quadratic smoothing through midpoints.
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
    case 'long':
    case 'short':
      return renderPosition(g, d, proj, selected);
  }

  // Two-point tools.
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
    case 'trendline': {
      line(g, x1, y1, x2, y2);
      if (selected) { handle(g, x1, y1, d.color); handle(g, x2, y2, d.color); }
      return;
    }
    case 'rectangle': {
      g.save();
      g.globalAlpha = 0.12;
      g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      g.restore();
      g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      if (selected) { handle(g, x1, y1, d.color); handle(g, x2, y2, d.color); }
      return;
    }
    case 'channel': {
      // Main line p0→p1; parallel line shifted by the 3rd point's price offset.
      line(g, x1, y1, x2, y2);
      const off = pts[2] ? channelOffset(pts, toY) : 0;
      const y1b = toY(pts[0].price + off);
      const y2b = toY(pts[1].price + off);
      if (y1b != null && y2b != null) {
        line(g, x1, y1b, x2, y2b);
        g.save();
        g.globalAlpha = 0.08;
        g.beginPath();
        g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo(x2, y2b); g.lineTo(x1, y1b);
        g.closePath();
        g.fill();
        g.restore();
      }
      if (selected) {
        handle(g, x1, y1, d.color); handle(g, x2, y2, d.color);
        if (y1b != null) handle(g, x1, y1b, d.color);
      }
      return;
    }
    case 'fib': {
      const hi = pts[0].price;
      const lo = pts[1].price;
      g.save();
      g.font = '10px var(--font-mono)';
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
        g.fillText(`${(lvl * 100).toFixed(1)}%  ${price.toFixed(4)}`, right + 4, y + 3);
      }
      g.restore();
      if (selected) { handle(g, x1, y1, d.color); handle(g, x2, y2, d.color); }
      return;
    }
  }
}

/** Long / short position risk-reward box. */
function renderPosition(g: CanvasRenderingContext2D, d: Drawing, proj: Projector, selected: boolean) {
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

  // Reward (target) zone — green; Risk (stop) zone — red.
  g.save();
  g.globalAlpha = 0.14;
  g.fillStyle = BULL;
  g.fillRect(x, Math.min(yE, yT), w, Math.abs(yT - yE));
  g.fillStyle = BEAR;
  g.fillRect(x, Math.min(yE, yS), w, Math.abs(yS - yE));
  g.restore();

  g.lineWidth = 1;
  g.strokeStyle = BULL; line(g, x, yT, x + w, yT);
  g.strokeStyle = BEAR; line(g, x, yS, x + w, yS);
  g.strokeStyle = '#b2b5be'; line(g, x, yE, x + w, yE);

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = risk > 0 ? reward / risk : 0;
  const riskPct = (risk / entry) * 100;
  const rewardPct = (reward / entry) * 100;
  chip(g, `TP ${target.toFixed(4)}  +${rewardPct.toFixed(2)}%`, x, yT - 9, BULL);
  chip(g, `SL ${stop.toFixed(4)}  -${riskPct.toFixed(2)}%`, x, yS + 9, BEAR);
  chip(g, `${d.tool === 'long' ? 'LONG' : 'SHORT'}  RR ${rr.toFixed(2)}`, x, yE, '#2962ff');

  if (selected) {
    handle(g, x, yE, d.color);
    handle(g, x + w, yT, d.color);
    handle(g, x + w, yS, d.color);
  }
}

// ---------- transient measure overlay ----------
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
  const up = b.price >= a.price;
  const color = up ? BULL : BEAR;

  g.save();
  g.globalAlpha = 0.12;
  g.fillStyle = color;
  g.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  g.restore();
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));

  const diff = b.price - a.price;
  const pct = (diff / a.price) * 100;
  const minutes = Math.round(Math.abs(b.time - a.time) / 60);
  const lines = [
    `${diff >= 0 ? '+' : ''}${diff.toFixed(4)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`,
    `${bars} bars,  ${formatDuration(minutes)}`,
  ];
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  g.save();
  g.font = '11px var(--font-sans)';
  const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 14;
  g.fillStyle = color;
  g.fillRect(cx - tw / 2, cy - 18, tw, 34);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, cx, cy - 6 + i * 14));
  g.restore();
}

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}

// ---------- helpers ----------
function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
}

function project(p: Point, toX: (t: number) => number | null, toY: (v: number) => number | null) {
  const x = toX(p.time);
  const y = toY(p.price);
  return x == null || y == null ? null : { x, y };
}

/** Vertical price offset (in price units) of a channel's parallel line. */
function channelOffset(pts: Point[], _toY: (v: number) => number | null): number {
  const [a, b, c] = pts;
  if (!c) return 0;
  // Price on the main line at c.time, then the offset to c.
  const span = b.time - a.time || 1;
  const t = (c.time - a.time) / span;
  const priceOnLine = a.price + (b.price - a.price) * t;
  return c.price - priceOnLine;
}
