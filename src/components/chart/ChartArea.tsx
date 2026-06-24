'use client';
import { useMemo, useState } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { useMarketData } from '@/hooks/useMarketData';
import { useVisibleCandles } from '@/hooks/useVisibleCandles';
import { useChartStore } from '@/store/chartStore';
import { getSymbol } from '@/services/marketData';
import { fmtPrice, fmtVolume } from '@/utils/format';
import { PriceChart } from './PriceChart';
import { IndicatorPane } from './IndicatorPane';
import { DrawingLayer } from './DrawingLayer';
import { AlertLines } from './AlertLines';
import { ReplaySelectionLayer } from '@/components/replay/ReplaySelectionLayer';
import { SmcLayer } from '@/components/smc/SmcLayer';
import { TradeLevels } from '@/components/trade/TradeLevels';
import { RiskPanel } from '@/components/trade/RiskPanel';
import { Loader2 } from 'lucide-react';

/** Center chart region: price chart, SMC + drawing overlays, indicator panes. */
export function ChartArea() {
  useMarketData();
  const candles = useVisibleCandles();
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const loading = useChartStore((s) => s.loading);
  const indicators = useChartStore((s) => s.indicators);
  const crosshair = useChartStore((s) => s.crosshair);
  const [mainChart, setMainChart] = useState<IChartApi | null>(null);

  const precision = getSymbol(symbol)?.pricePrecision ?? 2;
  const paneIndicators = useMemo(
    () => indicators.filter((i) => i.visible && i.separatePane),
    [indicators],
  );

  const last = candles[candles.length - 1];
  const legend = crosshair?.candle ?? last;
  const up = legend ? legend.close >= legend.open : true;

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* OHLC legend */}
      <div className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs">
        <span className="text-sm font-semibold text-ink">{symbol}</span>
        <span className="text-ink-muted">{timeframe}</span>
        {legend && (
          <span className="tabular flex gap-2" style={{ color: up ? 'var(--bull)' : 'var(--bear)' }}>
            <span>O {fmtPrice(legend.open, precision)}</span>
            <span>H {fmtPrice(legend.high, precision)}</span>
            <span>L {fmtPrice(legend.low, precision)}</span>
            <span>C {fmtPrice(legend.close, precision)}</span>
            <span className="text-ink-muted">V {fmtVolume(legend.volume)}</span>
          </span>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-terminal-bg/40">
          <Loader2 className="animate-spin text-brand" size={24} />
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <PriceChart candles={candles} onReady={setMainChart}>
          <SmcLayer />
          <TradeLevels />
          <AlertLines />
          <DrawingLayer />
          <ReplaySelectionLayer />
        </PriceChart>
        <RiskPanel />
      </div>

      {paneIndicators.map((cfg) => (
        <IndicatorPane key={cfg.id} cfg={cfg} candles={candles} mainChart={mainChart} />
      ))}
    </div>
  );
}
