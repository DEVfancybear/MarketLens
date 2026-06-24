'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { useChartCtx } from '@/components/chart/ChartContext';
import { useSmcStore } from '@/store/smcStore';
import { useChartStore } from '@/store/chartStore';
import { getSymbol } from '@/services/marketData';
import { fmtPrice } from '@/utils/format';
import { fmtDate } from '@/utils/time';

/** Set `window.__SMC_DEBUG__ = true` in the console to log coordinate mapping. */
type SmcDebugWindow = Window & { __SMC_DEBUG__?: boolean };

/**
 * Read-only canvas overlay that paints the SMC snapshot in (time, price) space,
 * re-projecting every frame so structures stay pinned through pan & zoom.
 * Styled to read like TradingView chart objects: semi-transparent zones with
 * thin borders, chip labels and right-edge price tags.
 */
export function SmcLayer() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshot = useSmcStore((s) => s.snapshot);
  const settings = useSmcStore((s) => s.settings);
  const timeframe = useChartStore((s) => s.timeframe);
  const symbol = useChartStore((s) => s.symbol);

  const paint = useCallback(() => {
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

    const ts = ctx.chart.timeScale();
    const range = ts.getVisibleRange();
    if (!range) return;
    const fromT = range.from as number;
    const toT = range.to as number;
    // Drawable width = the time-scale width, which EXCLUDES the right price axis.
    // Using rect.width (the whole canvas) would let zones and price tags spill
    // over the price scale and collide with its labels. Fall back to the canvas
    // width if the time scale hasn't measured yet (transient 0 on first frame).
    const W = ts.width() || rect.width;

    /**
     * Candle time -> x pixel. ALWAYS resolve the real position via
     * timeToCoordinate; only fall back to a chart edge when the time is off the
     * visible range (timeToCoordinate returns null). The previous code clamped
     * any time >= the last data bar to the far right, which collapsed every
     * recent SMC object against the right edge ("compressed at the right side").
     */
    const xAt = (time: number): number => {
      const c = ts.timeToCoordinate(time as UTCTimestamp);
      if (c != null) return c;
      return time < fromT ? 0 : W; // off-screen: clamp to the nearer edge
    };
    /** Price -> y pixel via the candle series' own price scale. */
    const yAt = (price: number): number | null => ctx.candleSeries.priceToCoordinate(price);
    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    const colBos = css('--bos') || '#2962ff';
    const colChoch = css('--choch') || '#ff9800';
    const colFvg = css('--fvg') || '#5b9cf6';
    const colOb = css('--ob') || '#9c27b0';
    const colLiq = css('--liquidity') || '#f06292';
    const colBull = css('--bull') || '#26a69a';
    const colBear = css('--bear') || '#ef5350';
    const colMuted = css('--text-muted') || '#868993';

    g.font = '10px var(--font-mono)';
    g.textBaseline = 'middle';

    const prec = getSymbol(symbol)?.pricePrecision ?? 2;

    /** TradingView-style filled chip label. */
    const chip = (text: string, x: number, y: number, color: string, align: 'left' | 'right' = 'left') => {
      g.font = '10px var(--font-sans)';
      const padX = 4;
      const w = g.measureText(text).width + padX * 2;
      const h = 14;
      const bx = align === 'right' ? x - w : x;
      g.fillStyle = color;
      g.globalAlpha = 0.92;
      roundRect(g, bx, y - h / 2, w, h, 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = '#ffffff';
      g.fillText(text, bx + padX, y + 0.5);
    };

    /** Right-edge price tag (like a horizontal-ray price label). */
    const priceTag = (price: number, y: number, color: string) => {
      const text = fmtPrice(price, prec);
      g.font = '10px var(--font-mono)';
      const w = g.measureText(text).width + 8;
      const h = 14;
      const bx = W - w - 1;
      g.fillStyle = color;
      roundRect(g, bx, y - h / 2, w, h, 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(text, bx + 4, y + 0.5);
    };

    // --- Sessions (background tint + hi/lo/mid) ---
    if (settings.sessions) {
      const tint: Record<string, string> = {
        asian: 'rgba(120,130,160,0.05)',
        london: 'rgba(41,98,255,0.05)',
        newyork: 'rgba(38,166,154,0.05)',
      };
      for (const s of snapshot.sessions) {
        if (s.endTime < fromT || s.startTime > toT) continue;
        const x1 = xAt(s.startTime);
        const x2 = xAt(s.endTime);
        g.fillStyle = tint[s.name] ?? 'rgba(255,255,255,0.03)';
        g.fillRect(x1, 0, Math.max(1, x2 - x1), rect.height);
        const yh = yAt(s.high);
        const yl = yAt(s.low);
        const ym = yAt(s.mid);
        g.strokeStyle = colMuted;
        g.globalAlpha = 0.35;
        g.setLineDash([2, 3]);
        [yh, yl, ym].forEach((y) => {
          if (y == null) return;
          g.beginPath();
          g.moveTo(x1, y);
          g.lineTo(x2, y);
          g.stroke();
        });
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
    }

    // --- Kill zones (subtle vertical bands) ---
    if (settings.killzones) {
      g.fillStyle = 'rgba(255,152,0,0.06)';
      for (const z of snapshot.killZones) {
        if (z.endTime < fromT || z.startTime > toT) continue;
        const x1 = xAt(z.startTime);
        const x2 = xAt(z.endTime);
        g.fillRect(x1, 0, Math.max(1, x2 - x1), rect.height);
      }
    }

    // --- FVG zones ---
    if (settings.fvg) {
      for (const f of snapshot.fvgs) {
        const yTop = yAt(f.top);
        const yBot = yAt(f.bottom);
        if (yTop == null || yBot == null) continue;
        const x1 = xAt(f.time);
        const x2 = W;
        const base = f.direction === 'bullish' ? colBull : colBear;
        const top = Math.min(yTop, yBot);
        const h = Math.abs(yBot - yTop);
        g.globalAlpha = f.state === 'active' ? 0.14 : 0.06;
        g.fillStyle = base;
        g.fillRect(x1, top, x2 - x1, h);
        // Thin upper/lower borders in the FVG accent colour (TradingView style).
        g.globalAlpha = f.state === 'active' ? 0.5 : 0.2;
        g.strokeStyle = colFvg;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x1, top); g.lineTo(x2, top);
        g.moveTo(x1, top + h); g.lineTo(x2, top + h);
        g.stroke();
        g.globalAlpha = 1;
      }
    }

    // --- Order blocks ---
    if (settings.orderBlocks) {
      for (const o of snapshot.orderBlocks) {
        if (o.state === 'invalidated') continue;
        const yTop = yAt(o.top);
        const yBot = yAt(o.bottom);
        if (yTop == null || yBot == null) continue;
        const x1 = xAt(o.time);
        g.globalAlpha = o.state === 'fresh' ? 0.18 : 0.08;
        g.fillStyle = colOb;
        g.fillRect(x1, Math.min(yTop, yBot), W - x1, Math.abs(yBot - yTop));
        g.globalAlpha = 1;
        g.strokeStyle = colOb;
        g.lineWidth = 1;
        g.strokeRect(x1, Math.min(yTop, yBot), W - x1, Math.abs(yBot - yTop));
        const label = `${o.direction === 'bullish' ? 'OB' : 'OB'}-${timeframe}${o.hasDisplacement ? ' ⚡' : ''}`;
        chip(label, x1 + 2, Math.min(yTop, yBot) + 8, colOb);
      }
    }

    // --- Liquidity pools ---
    if (settings.liquidity) {
      for (const l of snapshot.liquidity) {
        const y = yAt(l.price);
        if (y == null) continue;
        const x1 = xAt(l.time);
        g.strokeStyle = colLiq;
        g.lineWidth = 1.2;
        g.globalAlpha = l.swept ? 0.4 : 1;
        g.setLineDash(l.swept ? [3, 3] : []);
        g.beginPath();
        g.moveTo(x1, y);
        g.lineTo(W, y);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
        chip(`${l.kind}${l.swept ? ' ✕' : ''}`, x1 + 2, y - 9, colLiq);
        priceTag(l.price, y, colLiq);
      }
    }

    // --- Displacement candles ---
    if (settings.displacement) {
      for (const d of snapshot.displacements) {
        if (d.time < fromT || d.time > toT) continue;
        const x = xAt(d.time);
        const color = d.direction === 'bullish' ? colBull : colBear;
        // Faint vertical highlight on the displacement candle.
        g.globalAlpha = 0.18;
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, rect.height);
        g.stroke();
        g.globalAlpha = 1;
        // Direction triangle marker at the chart edge.
        const ty = d.direction === 'bullish' ? rect.height - 10 : 10;
        g.fillStyle = color;
        g.beginPath();
        if (d.direction === 'bullish') {
          g.moveTo(x, ty); g.lineTo(x - 4, ty + 7); g.lineTo(x + 4, ty + 7);
        } else {
          g.moveTo(x, ty); g.lineTo(x - 4, ty - 7); g.lineTo(x + 4, ty - 7);
        }
        g.closePath();
        g.fill();
      }
    }

    // --- Structure events (BOS / CHOCH / MSS) ---
    if (settings.structure) {
      for (const m of snapshot.structures) {
        const y = yAt(m.price);
        if (y == null) continue;
        const x1 = xAt(m.fromTime);
        const x2 = xAt(m.confirmedAtTime);
        const color = m.event === 'BOS' ? colBos : colChoch;
        g.strokeStyle = color;
        g.lineWidth = 1.2;
        g.setLineDash([4, 2]);
        g.beginPath();
        g.moveTo(x1, y);
        g.lineTo(x2, y);
        g.stroke();
        g.setLineDash([]);
        chip(m.event, x2 + 2, y, color);
      }
    }

    // --- Swing labels ---
    if (settings.swings) {
      g.font = '9px var(--font-mono)';
      for (const s of snapshot.swings) {
        if (!s.label) continue;
        const y = yAt(s.price);
        if (y == null) continue;
        const x = xAt(s.time);
        g.fillStyle = s.kind === 'high' ? colBear : colBull;
        g.fillText(s.label, x - 8, s.kind === 'high' ? y - 8 : y + 8);
      }
    }

    // --- Debug mode: window.__SMC_DEBUG__ = true to trace coordinate mapping ---
    if (typeof window !== 'undefined' && (window as SmcDebugWindow).__SMC_DEBUG__) {
      const row = (feature: string, time: number, price: number) => ({
        feature,
        time: fmtDate(time),
        price: Number(price.toFixed(prec)),
        x: Math.round(xAt(time)),
        y: Math.round(yAt(price) ?? -1),
        paneW: Math.round(W),
      });
      const rows: ReturnType<typeof row>[] = [];
      if (snapshot.structures[0]) rows.push(row('BOS/CHOCH', snapshot.structures[0].confirmedAtTime, snapshot.structures[0].price));
      if (snapshot.fvgs[0]) rows.push(row('FVG', snapshot.fvgs[0].time, snapshot.fvgs[0].top));
      if (snapshot.orderBlocks[0]) rows.push(row('OrderBlock', snapshot.orderBlocks[0].time, snapshot.orderBlocks[0].top));
      if (snapshot.liquidity[0]) rows.push(row('Liquidity', snapshot.liquidity[0].time, snapshot.liquidity[0].price));
      if (snapshot.swings[0]) rows.push(row('Swing', snapshot.swings[0].time, snapshot.swings[0].price));
      if (rows.length) console.log('SMC DEBUG:', rows);
    }
  }, [ctx, snapshot, settings, timeframe, symbol]);

  /**
   * Force a redraw on the next animation frame whenever the SMC settings,
   * snapshot, symbol/timeframe or the chart's visible range (ctx.version)
   * change. `paint` already closes over `settings`/`snapshot`, but we also list
   * them explicitly so the redraw is unmistakably reactive to every toggle —
   * no stale closure, no missed dependency. The overlay never touches the time
   * scale, so chart zoom and candle position are preserved across toggles.
   */
  useEffect(() => {
    const id = requestAnimationFrame(() => paint());
    return () => cancelAnimationFrame(id);
  }, [paint, settings, snapshot, timeframe, symbol, ctx?.version]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/** Rounded-rectangle path (CanvasRenderingContext2D.roundRect fallback). */
function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius);
  g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius);
  g.closePath();
}
