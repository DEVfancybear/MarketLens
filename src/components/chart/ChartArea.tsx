"use client";
import { useMemo, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import { useMarketData } from "@/hooks/useMarketData";
import { useVisibleCandles } from "@/hooks/useVisibleCandles";
import { useChartStore } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtPrice, fmtVolume } from "@/utils/format";
import { useCountdown } from "@/hooks/useCountdown";
import { PriceChart } from "./PriceChart";
import { IndicatorPane } from "./IndicatorPane";
import { DrawingLayer } from "./DrawingLayer";
import { AlertOverlay } from "./AlertOverlay";
import { ReplaySelectionLayer } from "@/components/replay/ReplaySelectionLayer";
import { SmcLayer } from "@/components/smc/SmcLayer";
import { TradeLevels } from "@/components/trade/TradeLevels";
import { RiskPanel } from "@/components/trade/RiskPanel";
import { Loader2 } from "lucide-react";

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

  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const countdown = useCountdown(timeframe);
  const paneIndicators = useMemo(
    () => indicators.filter((i) => i.visible && i.separatePane),
    [indicators],
  );

  const last = candles[candles.length - 1];
  const legend = crosshair?.candle ?? last;
  const up = legend ? legend.close >= legend.open : true;

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* TradingView-style chart header: symbol + TF + countdown + OHLC */}
      <div className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="text-sm font-bold text-ink">{symbol}</span>
        <span className="text-xs text-ink-muted">{timeframe}</span>
        <span className="text-xs font-medium tabular text-ink-faint">
          {countdown}
        </span>
        {legend && (
          <span
            className="flex gap-2 text-[11px]"
            style={{ color: up ? "var(--bull)" : "var(--bear)" }}
          >
            <span>O</span>
            <span className="tabular">{fmtPrice(legend.open, precision)}</span>
            <span>H</span>
            <span className="tabular">{fmtPrice(legend.high, precision)}</span>
            <span>L</span>
            <span className="tabular">{fmtPrice(legend.low, precision)}</span>
            <span>C</span>
            <span className="tabular">{fmtPrice(legend.close, precision)}</span>
            <span className="text-ink-muted">V</span>
            <span className="tabular text-ink-muted">
              {fmtVolume(legend.volume)}
            </span>
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
          <AlertOverlay />
          <DrawingLayer />
          <ReplaySelectionLayer />
        </PriceChart>
        <RiskPanel />
      </div>

      {paneIndicators.map((cfg) => (
        <IndicatorPane
          key={cfg.id}
          cfg={cfg}
          candles={candles}
          mainChart={mainChart}
        />
      ))}
    </div>
  );
}
