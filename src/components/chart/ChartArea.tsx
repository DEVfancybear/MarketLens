"use client";
import { useMemo, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import { useMarketData } from "@/hooks/useMarketData";
import { useVisibleCandles } from "@/hooks/useVisibleCandles";
import { useChartStore } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { PriceMarkerLabel } from "./PriceMarkerLabel";
import { PriceChart } from "./PriceChart";
import { IndicatorPane } from "./IndicatorPane";
import { DrawingLayer } from "./DrawingLayer";
import { AlertOverlay } from "./AlertOverlay";
import { ReplaySelectionLayer } from "@/components/replay/ReplaySelectionLayer";
import { SmcLayer } from "@/components/smc/SmcLayer";
import { TradeLevels } from "@/components/trade/TradeLevels";
import { RiskPanel } from "@/components/trade/RiskPanel";
import { Loader2 } from "lucide-react";
import { fmtPrice } from "@/utils/format";

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

  const meta = getMarketSymbol(symbol);
  const precision = meta?.pricePrecision ?? 2;
  const exchange = meta?.exchange ?? "";
  const paneIndicators = useMemo(
    () => indicators.filter((i) => i.visible && i.separatePane),
    [indicators],
  );

  const last = candles[candles.length - 1];
  const legend = crosshair?.candle ?? last;
  const up = legend ? legend.close >= legend.open : true;

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Compact TradingView chart header: symbol · exchange · TF | OHLC */}
      <div className="pointer-events-none absolute left-3 top-1 z-10 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-[11px] leading-none text-ink-muted">
          <span className="font-bold text-ink">{symbol}</span>
          {exchange && <span>·</span>}
          {exchange && <span>{exchange}</span>}
          <span>·</span>
          <span>{timeframe}</span>
        </div>
        {legend && (
          <div
            className="flex items-center gap-1.5 text-[11px] leading-none"
            style={{ color: up ? "var(--bull)" : "var(--bear)" }}
          >
            <span className="font-medium">O</span>
            <span className="tabular">{fmtPrice(legend.open, precision)}</span>
            <span className="font-medium">H</span>
            <span className="tabular">{fmtPrice(legend.high, precision)}</span>
            <span className="font-medium">L</span>
            <span className="tabular">{fmtPrice(legend.low, precision)}</span>
            <span className="font-medium">C</span>
            <span className="tabular">{fmtPrice(legend.close, precision)}</span>
          </div>
        )}
      </div>

      {/* Price marker on RIGHT side: symbol + price + countdown */}
      <PriceMarkerLabel />

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
