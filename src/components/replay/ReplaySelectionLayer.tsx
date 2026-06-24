'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { useChartCtx } from '@/components/chart/ChartContext';
import { useReplayStore } from '@/store/replayStore';
import { useChartStore } from '@/store/chartStore';
import { useUIStore } from '@/store/uiStore';
import { indexAtOrBefore } from '@/services/replayEngine';
import { fmtDateTime } from '@/utils/time';

/**
 * TradingView-style Bar Replay start selection.
 *
 * Rendered as the TOP overlay inside the chart's context. While the replay
 * store is in `selecting` mode this canvas:
 *   - captures pointer events (pointer-events: auto, z-index above the chart),
 *   - disables the chart's own pan/zoom so the cursor stays put,
 *   - draws a vertical cursor snapped to the nearest candle + a date label and
 *     a shaded "future" region to the right,
 *   - on click, arms replay at that candle (hiding everything after it).
 *
 * When not selecting it is pointer-events:none and paints nothing, so it never
 * blocks normal chart interaction or the drawing layer.
 */
export function ReplaySelectionLayer() {
  const ctx = useChartCtx();
  const selecting = useReplayStore((s) => s.selecting);
  const arm = useReplayStore((s) => s.arm);
  const cancelSelect = useReplayStore((s) => s.cancelSelect);
  const setBottomTab = useUIStore((s) => s.setBottomTab);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // While not armed, ctx.candles is the full master series — exactly what we
  // want to pick a start bar from. Memoised so hook deps stay stable.
  const candles = useMemo(() => ctx?.candles ?? [], [ctx]);

  // ---- Disable chart pan/zoom while selecting; restore afterwards ----
  useEffect(() => {
    if (!ctx) return;
    ctx.chart.applyOptions(
      selecting
        ? { handleScroll: false, handleScale: false }
        : { handleScroll: true, handleScale: true },
    );
    if (!selecting) setHoverIdx(null);
    return () => {
      ctx.chart.applyOptions({ handleScroll: true, handleScale: true });
    };
  }, [selecting, ctx]);

  // ---- Esc cancels selection ----
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelSelect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, cancelSelect]);

  // ---- Snap a clientX to the nearest candle index ----
  const nearestIndex = useCallback(
    (clientX: number): number | null => {
      const canvas = canvasRef.current;
      if (!ctx || !canvas || candles.length === 0) return null;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const ts = ctx.chart.timeScale();
      const t = ts.coordinateToTime(x);
      if (t == null) return candles.length - 1; // right whitespace → last bar
      const time = t as number;
      const before = indexAtOrBefore(candles, time);
      const after = Math.min(candles.length - 1, before + 1);
      return Math.abs(candles[before].time - time) <= Math.abs(candles[after].time - time)
        ? before
        : after;
    },
    [ctx, candles],
  );

  // ---- Draw the snapping cursor ----
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
    if (!selecting || hoverIdx == null || !candles[hoverIdx]) return;

    const ts = ctx.chart.timeScale();
    const x = ts.timeToCoordinate(candles[hoverIdx].time as UTCTimestamp);
    if (x == null) return;
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2962ff';

    // Shade the would-be-hidden future region.
    g.fillStyle = 'rgba(41,98,255,0.07)';
    g.fillRect(x, 0, rect.width - x, rect.height);

    // Vertical selection line.
    g.strokeStyle = accent;
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, rect.height);
    g.stroke();
    g.setLineDash([]);

    // Date label chip.
    const label = fmtDateTime(candles[hoverIdx].time);
    g.font = '10px var(--font-sans)';
    const w = g.measureText(label).width + 12;
    g.fillStyle = accent;
    g.fillRect(x - w / 2, 4, w, 16);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(label, x, 12.5);
    g.textAlign = 'start';
  }, [ctx, selecting, hoverIdx, candles]);

  useEffect(() => {
    draw();
  }, [draw, ctx?.version]);

  // ---- Pointer handlers ----
  const onMove = (e: React.PointerEvent) => {
    if (!selecting) return;
    const idx = nearestIndex(e.clientX);
    if (idx !== hoverIdx) {
      setHoverIdx(idx);
      if (idx != null && candles[idx]) {
        console.debug('Replay hover:', {
          x: Math.round(e.clientX),
          index: idx,
          time: fmtDateTime(candles[idx].time),
        });
      }
    }
  };

  const onSelect = (e: React.PointerEvent) => {
    if (!selecting) return;
    e.preventDefault();
    const idx = nearestIndex(e.clientX);
    if (idx == null || !candles[idx]) return;
    const total = useChartStore.getState().candles.length;
    console.debug('Replay start selected:', {
      index: idx,
      time: fmtDateTime(candles[idx].time),
      timestamp: candles[idx].time,
      total,
    });
    arm(idx, total);
    setBottomTab('replay');
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerMove={onMove}
      onPointerDown={onSelect}
      onPointerLeave={() => selecting && setHoverIdx(null)}
      className="absolute inset-0 h-full w-full"
      style={{
        zIndex: 30,
        pointerEvents: selecting ? 'auto' : 'none',
        cursor: selecting ? 'crosshair' : 'default',
      }}
    />
  );
}
