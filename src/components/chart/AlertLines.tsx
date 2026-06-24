'use client';
import { useEffect, useRef } from 'react';
import type { IPriceLine } from 'lightweight-charts';
import { useChartCtx } from './ChartContext';
import { useAlertStore } from '@/store/alertStore';
import { useChartStore } from '@/store/chartStore';

/**
 * Renders price alerts (created via the chart context menu) as dashed price
 * lines on the candle series for the current symbol. Pure chart side-effect.
 */
export function AlertLines() {
  const ctx = useChartCtx();
  const alerts = useAlertStore((s) => s.alerts);
  const symbol = useChartStore((s) => s.symbol);
  const linesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!ctx) return;
    const series = ctx.candleSeries;
    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = alerts
      .filter((a) => a.symbol === symbol)
      .map((a) =>
        series.createPriceLine({
          price: a.price,
          color: '#f7a600',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'Alert',
        }),
      );
    return () => {
      linesRef.current.forEach((l) => series.removePriceLine(l));
      linesRef.current = [];
    };
  }, [ctx, alerts, symbol]);

  return null;
}
