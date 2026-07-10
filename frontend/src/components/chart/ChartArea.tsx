"use client";
import { useEffect, useMemo, useState } from "react";
import type { IChartApi } from "lightweight-charts";
import { useMarketData } from "@/hooks/useMarketData";
import { useChartSeries } from "@/hooks/useChartSeries";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { useAtomValue } from "jotai";
import {
  symbolAtom,
  timeframeAtom,
  candlesAtom,
  loadingAtom,
  indicatorsAtom,
  crosshairAtom,
} from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { PriceChart } from "./PriceChart";
import { ChartTimeToolbar } from "./ChartTimeToolbar";
import { IndicatorPane } from "./IndicatorPane";
import { DrawingLayer } from "./DrawingLayer";
import { AlertOverlay } from "./AlertOverlay";
import { AlertLines } from "./AlertLines";
import { ReplaySelectionLayer } from "@/components/replay/ReplaySelectionLayer";
import { ReplayFloatingToolbar } from "@/components/replay/ReplayFloatingToolbar";
import { SmcLayer } from "@/components/smc/SmcLayer";
import { TradeLevels } from "@/components/trade/TradeLevels";
import { RiskPanel } from "@/components/trade/RiskPanel";
import { Loader2 } from "lucide-react";
import { fmtPrice } from "@/utils/format";
import { ChartPerformanceOverlay } from "./ChartPerformanceOverlay";
import {
  createChartBenchmarkCandles,
  createPhase2BenchmarkIndicators,
  isChartBenchmarkSize,
  setActiveChartBenchmarkCandles,
} from "@/services/chartBenchmarkFixtures";
import type { Candle } from "@/types";

/** Center chart region: price chart, SMC + drawing overlays, indicator panes. */
export function ChartArea() {
  const replay = useReplayClientProjection();
  const { loadOlderCandles } = useMarketData({
    enabled: !replay.snapshot && replay.connection !== "connecting",
  });
  const candles = useChartSeries();
  const replaySelectionCandidates = useAtomValue(candlesAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const loading = useAtomValue(loadingAtom);
  const indicators = useAtomValue(indicatorsAtom);
  const crosshair = useAtomValue(crosshairAtom);
  const [mainChart, setMainChart] = useState<IChartApi | null>(null);
  const [benchmarkCandles, setBenchmarkCandles] = useState<Candle[] | null>(null);
  const [benchmarkVisibleCount, setBenchmarkVisibleCount] = useState<number | null>(null);
  const [phase2BenchmarkProfile, setPhase2BenchmarkProfile] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const requested = Number(new URLSearchParams(window.location.search).get("chartFixture"));
    if (!isChartBenchmarkSize(requested)) return;
    setPhase2BenchmarkProfile(
      new URLSearchParams(window.location.search).get("chartBenchmarkProfile") === "phase2",
    );
    const fixture = createChartBenchmarkCandles(requested);
    setActiveChartBenchmarkCandles(fixture);
    setBenchmarkCandles(fixture);
    setBenchmarkVisibleCount(fixture.length);
    const handleReplay = (event: Event) => {
      const count = (event as CustomEvent<{ count?: number }>).detail?.count;
      if (Number.isFinite(count)) {
        const nextCount = Math.max(1, Math.min(fixture.length, Number(count)));
        setBenchmarkVisibleCount(nextCount);
        setActiveChartBenchmarkCandles(fixture.slice(0, nextCount));
      }
    };
    window.addEventListener("chart-benchmark-replay", handleReplay);
    return () => {
      window.removeEventListener("chart-benchmark-replay", handleReplay);
      setActiveChartBenchmarkCandles(null);
    };
  }, []);

  const displayedCandles = useMemo(
    () => benchmarkCandles
      ? benchmarkCandles.slice(0, benchmarkVisibleCount ?? benchmarkCandles.length)
      : candles,
    [benchmarkCandles, benchmarkVisibleCount, candles],
  );

  const meta = getMarketSymbol(symbol);
  const precision = meta?.pricePrecision ?? 2;
  const exchange = meta?.exchange ?? "";
  const displayedIndicators = useMemo(
    () => phase2BenchmarkProfile ? createPhase2BenchmarkIndicators() : indicators,
    [indicators, phase2BenchmarkProfile],
  );
  const paneIndicators = useMemo(
    () => displayedIndicators.filter((i) => i.separatePane),
    [displayedIndicators],
  );
  const replayOwnsChart = Boolean(replay.snapshot) ||
    replay.connection === "connecting" ||
    replay.connection === "recovering";
  const showLoading = benchmarkCandles
    ? false
    : replayOwnsChart
      ? replay.connection === "connecting" && candles.length === 0
      : loading;

  const last = displayedCandles[displayedCandles.length - 1];
  const legend = crosshair?.candle ?? last;
  const up = legend ? legend.close >= legend.open : true;

  return (
    <div className="relative flex h-full w-full flex-col">
      <ChartPerformanceOverlay />
      {/* Chart header: symbol · exchange · TF + OHLC row */}
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

      {/* Current-price marker is rendered inside PriceChart so it can track the price scale. */}

      {showLoading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-terminal-bg/40">
          <Loader2 className="animate-spin text-brand" size={24} />
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <PriceChart
          candles={displayedCandles}
          indicatorsOverride={displayedIndicators}
          onLoadMoreHistory={benchmarkCandles ? undefined : loadOlderCandles}
          onReady={setMainChart}
        >
          <SmcLayer />
          <TradeLevels />
          <AlertLines />
          <AlertOverlay />
          <DrawingLayer />
          <ReplaySelectionLayer candidates={replaySelectionCandidates} />
        </PriceChart>
        <ReplayFloatingToolbar />
        <RiskPanel />
      </div>

      {paneIndicators.map((cfg) => (
        <IndicatorPane
          key={cfg.id}
          cfg={cfg}
          candles={displayedCandles}
          mainChart={mainChart}
        />
      ))}

      <ChartTimeToolbar chart={mainChart} candles={displayedCandles} />
    </div>
  );
}
