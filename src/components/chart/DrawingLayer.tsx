'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { useChartCtx } from './ChartContext';
import { useChartStore } from '@/store/chartStore';
import { FIB_LEVELS, type Drawing, type Point } from '@/types';
import { uid } from '@/utils/id';

/**
 * Transparent canvas laid over the price chart that renders user drawings and
 * handles their creation / selection / movement. All geometry is stored in
 * (time, price) space and projected to pixels each frame, so drawings stay
 * pinned to the data through pan & zoom.
 */
export function DrawingLayer() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    drawings, activeTool, drawColor, selectedDrawingId,
    addDrawing, updateDrawing, selectDrawing, removeDrawing, setActiveTool,
  } = useChartStore();

  // In-progress drawing (first point placed, awaiting second).
  const [pending, setPending] = useState<Point[] | null>(null);
  const dragRef = useRef<{ id: string; startTime: number; startPrice: number; orig: Point[] } | null>(null);

  // ---- coordinate helpers ----
  const toX = useCallback((time: number) => ctx?.chart.timeScale().timeToCoordinate(time as UTCTimestamp) ?? null, [ctx]);
  const toY = useCallback((price: number) => ctx?.candleSeries.priceToCoordinate(price) ?? null, [ctx]);
  const fromEvent = useCallback(
    (e: React.PointerEvent | PointerEvent): Point | null => {
      if (!ctx || !canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = ctx.chart.timeScale().coordinateToTime(x);
      const price = ctx.candleSeries.coordinateToPrice(y);
      if (time == null || price == null) return null;
      return { time: time as number, price };
    },
    [ctx],
  );

  // ---- rendering ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    const all = pending
      ? [...drawings, { id: '__pending', tool: activeTool, color: drawColor, lineWidth: 1.5, points: pending } as Drawing]
      : drawings;

    for (const d of all) {
      if (d.visible === false) continue;
      const selected = d.id === selectedDrawingId;
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.6 : 1);
      renderDrawing(g, d, rect, toX, toY, selected);
    }
  }, [ctx, drawings, pending, activeTool, drawColor, selectedDrawingId, toX, toY]);

  // Repaint whenever data, version (pan/zoom) or drawings change.
  useEffect(() => { draw(); }, [draw, ctx?.version]);

  // ---- interaction ----
  const onPointerDown = (e: React.PointerEvent) => {
    const p = fromEvent(e);
    if (!p || !ctx) return;

    if (activeTool === 'cursor') {
      const hit = hitTest(drawings, p, toX, toY);
      selectDrawing(hit?.id ?? null);
      if (hit) {
        dragRef.current = { id: hit.id, startTime: p.time, startPrice: p.price, orig: hit.points };
        (e.target as Element).setPointerCapture(e.pointerId);
      }
      return;
    }

    // Single-click tools.
    if (activeTool === 'horizontal') {
      addDrawing({ id: uid('dw'), tool: 'horizontal', color: drawColor, lineWidth: 1.5, points: [p] });
      return;
    }
    if (activeTool === 'vertical') {
      addDrawing({ id: uid('dw'), tool: 'vertical', color: drawColor, lineWidth: 1.5, points: [p] });
      return;
    }
    if (activeTool === 'text') {
      const text = window.prompt('Text:') || '';
      if (text) addDrawing({ id: uid('dw'), tool: 'text', color: drawColor, lineWidth: 1.5, points: [p], text });
      else setActiveTool('cursor');
      return;
    }

    // Two-click tools (trendline / rectangle / fib).
    if (!pending) {
      setPending([p]);
    } else {
      addDrawing({ id: uid('dw'), tool: activeTool, color: drawColor, lineWidth: 1.5, points: [pending[0], p] });
      setPending(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = fromEvent(e);
    if (!p) return;
    // Live preview of the second point.
    if (pending) {
      setPending([pending[0], p]);
      return;
    }
    // Dragging a selected drawing.
    const drag = dragRef.current;
    if (drag) {
      const dt = p.time - drag.startTime;
      const dp = p.price - drag.startPrice;
      updateDrawing(drag.id, { points: drag.orig.map((pt) => ({ time: pt.time + dt, price: pt.price + dp })) });
    }
  };

  const onPointerUp = () => { dragRef.current = null; };

  // Delete / Escape keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        removeDrawing(selectedDrawingId);
      }
      if (e.key === 'Escape') { setPending(null); setActiveTool('cursor'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedDrawingId, removeDrawing, setActiveTool]);

  const interactive = activeTool !== 'cursor' || pending !== null;

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute inset-0 h-full w-full"
      style={{ cursor: activeTool === 'cursor' ? 'default' : 'crosshair', pointerEvents: interactive || drawings.length ? 'auto' : 'none' }}
    />
  );
}

// ---------- rendering helpers ----------
type Proj = (v: number) => number | null;

function renderDrawing(
  g: CanvasRenderingContext2D,
  d: Drawing,
  rect: DOMRect,
  toX: Proj,
  toY: Proj,
  selected: boolean,
) {
  const pts = d.points;
  const handle = (x: number, y: number) => {
    if (!selected) return;
    g.save();
    g.fillStyle = '#fff';
    g.strokeStyle = d.color;
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 4, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  };

  if (d.tool === 'horizontal') {
    const y = toY(pts[0].price);
    if (y == null) return;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(rect.width, y);
    g.stroke();
    g.save();
    g.fillStyle = d.color;
    g.font = '10px var(--font-mono)';
    g.fillText(pts[0].price.toFixed(4), 4, y - 3);
    g.restore();
    return;
  }
  if (d.tool === 'vertical') {
    const x = toX(pts[0].time);
    if (x == null) return;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, rect.height);
    g.stroke();
    return;
  }
  if (d.tool === 'text') {
    const x = toX(pts[0].time);
    const y = toY(pts[0].price);
    if (x == null || y == null) return;
    g.save();
    g.font = '12px var(--font-sans)';
    g.fillStyle = d.color;
    g.fillText(d.text || '', x, y);
    g.restore();
    handle(x, y);
    return;
  }

  if (pts.length < 2) {
    // single placed point preview
    const x = toX(pts[0].time);
    const y = toY(pts[0].price);
    if (x != null && y != null) handle(x, y);
    return;
  }

  const x1 = toX(pts[0].time);
  const y1 = toY(pts[0].price);
  const x2 = toX(pts[1].time);
  const y2 = toY(pts[1].price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return;

  if (d.tool === 'trendline') {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    handle(x1, y1);
    handle(x2, y2);
    return;
  }
  if (d.tool === 'rectangle') {
    g.save();
    g.globalAlpha = 0.12;
    g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    g.restore();
    g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    handle(x1, y1);
    handle(x2, y2);
    return;
  }
  if (d.tool === 'fib') {
    const hi = pts[0].price;
    const lo = pts[1].price;
    g.save();
    g.font = '10px var(--font-mono)';
    for (const lvl of FIB_LEVELS) {
      const price = hi + (lo - hi) * lvl;
      const y = toY(price);
      if (y == null) continue;
      g.globalAlpha = 0.7;
      g.beginPath();
      g.moveTo(Math.min(x1, x2), y);
      g.lineTo(Math.max(x1, x2), y);
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = d.color;
      g.fillText(`${(lvl * 100).toFixed(1)}%  ${price.toFixed(4)}`, Math.max(x1, x2) + 4, y + 3);
    }
    g.restore();
    handle(x1, y1);
    handle(x2, y2);
  }
}

// ---------- hit testing ----------
function hitTest(drawings: Drawing[], p: Point, toX: Proj, toY: Proj): Drawing | null {
  const px = toX(p.time);
  const py = toY(p.price);
  if (px == null || py == null) return null;
  const TOL = 8;
  // Reverse order so topmost wins.
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    if (d.visible === false) continue;
    if (d.tool === 'horizontal') {
      const y = toY(d.points[0].price);
      if (y != null && Math.abs(y - py) < TOL) return d;
    } else if (d.tool === 'vertical') {
      const x = toX(d.points[0].time);
      if (x != null && Math.abs(x - px) < TOL) return d;
    } else if (d.tool === 'text') {
      const x = toX(d.points[0].time);
      const y = toY(d.points[0].price);
      if (x != null && y != null && Math.abs(x - px) < 40 && Math.abs(y - py) < 14) return d;
    } else if (d.points.length >= 2) {
      const x1 = toX(d.points[0].time);
      const y1 = toY(d.points[0].price);
      const x2 = toX(d.points[1].time);
      const y2 = toY(d.points[1].price);
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue;
      if (d.tool === 'rectangle' || d.tool === 'fib') {
        if (px >= Math.min(x1, x2) - TOL && px <= Math.max(x1, x2) + TOL &&
            py >= Math.min(y1, y2) - TOL && py <= Math.max(y1, y2) + TOL) return d;
      } else if (distToSegment(px, py, x1, y1, x2, y2) < TOL) return d;
    }
  }
  return null;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
