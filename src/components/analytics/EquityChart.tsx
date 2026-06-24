'use client';
import { useEffect, useRef } from 'react';
import {
  createChart, ColorType, type IChartApi, type UTCTimestamp,
} from 'lightweight-charts';
import type { EquityPoint } from '@/types';
import { useUIStore } from '@/store/uiStore';
import { chartColors } from '@/components/chart/chartTheme';

/** Equity curve (area) with the drawdown curve underneath. */
export function EquityChart({ equity }: { equity: EquityPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const theme = useUIStore((s) => s.theme);

  useEffect(() => {
    if (!ref.current) return;
    const c = chartColors(theme);
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.text, fontSize: 10, fontFamily: 'var(--font-sans)' },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border, timeVisible: false },
      handleScroll: false, handleScale: false,
    });
    chartRef.current = chart;

    const area = chart.addAreaSeries({
      lineColor: c.bull, topColor: 'rgba(38,166,154,0.25)', bottomColor: 'rgba(38,166,154,0.02)', lineWidth: 2,
    });
    const dd = chart.addAreaSeries({
      lineColor: c.bear, topColor: 'rgba(239,83,80,0.02)', bottomColor: 'rgba(239,83,80,0.20)', lineWidth: 1,
      priceScaleId: 'dd',
    });
    chart.priceScale('dd').applyOptions({ scaleMargins: { top: 0.7, bottom: 0 } });

    const seen = new Set<number>();
    const eqData = equity
      .filter((p) => !seen.has(p.time) && seen.add(p.time))
      .map((p) => ({ time: p.time as UTCTimestamp, value: p.equity }));
    const seen2 = new Set<number>();
    const ddData = equity
      .filter((p) => !seen2.has(p.time) && seen2.add(p.time))
      .map((p) => ({ time: p.time as UTCTimestamp, value: p.drawdown }));

    area.setData(eqData);
    dd.setData(ddData);
    chart.timeScale().fitContent();

    return () => { chart.remove(); chartRef.current = null; };
  }, [equity, theme]);

  return <div ref={ref} className="h-full w-full" />;
}
