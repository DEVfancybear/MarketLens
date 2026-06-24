'use client';
import { useEffect, useRef } from 'react';
import type { IPriceLine } from 'lightweight-charts';
import { useChartCtx } from '@/components/chart/ChartContext';
import { useTradeStore } from '@/store/tradeStore';
import { useChartStore } from '@/store/chartStore';

/**
 * Draws entry / stop / target price lines on the candle series for live
 * positions in the current symbol. Pure chart side-effect; renders nothing.
 */
export function TradeLevels() {
  const ctx = useChartCtx();
  const positions = useTradeStore((s) => s.positions);
  const symbol = useChartStore((s) => s.symbol);
  const linesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!ctx) return;
    const series = ctx.candleSeries;
    // Clear previous lines.
    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = [];

    const live = positions.filter(
      (p) => (p.status === 'open' || p.status === 'pending') && p.symbol === symbol,
    );

    for (const p of live) {
      const tag = p.side === 'long' ? 'L' : 'S';
      linesRef.current.push(
        series.createPriceLine({
          price: p.entry,
          color: p.status === 'pending' ? '#868993' : '#2962ff',
          lineWidth: 1,
          lineStyle: p.status === 'pending' ? 2 : 0,
          axisLabelVisible: true,
          title: `${tag} entry`,
        }),
      );
      if (p.stopLoss) {
        linesRef.current.push(
          series.createPriceLine({
            price: p.stopLoss, color: '#ef5350', lineWidth: 1, lineStyle: 2,
            axisLabelVisible: true, title: 'SL',
          }),
        );
      }
      if (p.takeProfit) {
        linesRef.current.push(
          series.createPriceLine({
            price: p.takeProfit, color: '#26a69a', lineWidth: 1, lineStyle: 2,
            axisLabelVisible: true, title: 'TP',
          }),
        );
      }
    }

    return () => {
      linesRef.current.forEach((l) => series.removePriceLine(l));
      linesRef.current = [];
    };
  }, [ctx, positions, symbol]);

  return null;
}
