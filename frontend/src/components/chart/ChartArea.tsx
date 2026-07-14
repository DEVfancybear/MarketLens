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
  loadingAtom,
  indicatorsAtom,
  crosshairAtom,
} from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { PriceChart } from "./PriceChart";
import { ChartTimeToolbar } from "./ChartTimeToolbar";
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
  const { loadOlderCandles, loadCandlesAroundTime } = useMarketData({
    enabled: !replay.snapshot && replay.connection !== "connecting",
  });
  const candles = useChartSeries();
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const loading = useAtomValue(loadingAtom);
  const indicators = useAtomValue(indicatorsAtom);
  const crosshair = useAtomValue(crosshairAtom);
  const [mainChart, setMainChart] = useState<IChartApi | null>(null);
  const [benchmarkCandles, setBenchmarkCandles] = useState<Candle[] | null>(null);
  const [benchmarkStartIndex, setBenchmarkStartIndex] = useState(0);
  const [benchmarkVisibleCount, setBenchmarkVisibleCount] = useState<number | null>(null);
  const [benchmarkProfile, setBenchmarkProfile] = useState<
    "workspace" | "phase2" | "phase3"
  >("workspace");

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const params = new URLSearchParams(window.location.search);
    const requested = Number(params.get("chartFixture"));
    if (!isChartBenchmarkSize(requested)) return;
    const requestedProfile = params.get("chartBenchmarkProfile");
    setBenchmarkProfile(
      requestedProfile === "phase2" || requestedProfile === "phase3"
        ? requestedProfile
        : "workspace",
    );
    const fixture = createChartBenchmarkCandles(requested);
    const requestedTail = Number(params.get("chartFixtureTail"));
    const initialStart = Number.isFinite(requestedTail) && requestedTail > 0
      ? Math.max(0, fixture.length - Math.floor(requestedTail))
      : 0;
    setBenchmarkStartIndex(initialStart);
    setActiveChartBenchmarkCandles(fixture.slice(initialStart));
    setBenchmarkCandles(fixture);
    setBenchmarkVisibleCount(fixture.length);
    const handleReplay = (event: Event) => {
      const detail = (event as CustomEvent<{
        count?: number;
        allowEmpty?: boolean;
      }>).detail;
      const count = detail?.count;
      if (Number.isFinite(count)) {
        const minimumCount = detail?.allowEmpty ? initialStart : initialStart + 1;
        const nextCount = Math.max(minimumCount, Math.min(fixture.length, Number(count)));
        setBenchmarkVisibleCount(nextCount);
        setActiveChartBenchmarkCandles(fixture.slice(initialStart, nextCount));
      }
    };
    const handlePrepend = (event: Event) => {
      const count = Number(
        (event as CustomEvent<{ count?: number }>).detail?.count ?? 0,
      );
      if (!Number.isFinite(count) || count <= 0) return;
      setBenchmarkStartIndex((current) => {
        const next = Math.max(0, current - Math.floor(count));
        setActiveChartBenchmarkCandles(fixture.slice(next));
        return next;
      });
    };
    window.addEventListener("chart-benchmark-replay", handleReplay);
    window.addEventListener("chart-benchmark-prepend", handlePrepend);
    return () => {
      window.removeEventListener("chart-benchmark-replay", handleReplay);
      window.removeEventListener("chart-benchmark-prepend", handlePrepend);
      setActiveChartBenchmarkCandles(null);
    };
  }, []);

  const displayedCandles = useMemo(
    () => benchmarkCandles
      ? benchmarkCandles.slice(
          benchmarkStartIndex,
          benchmarkVisibleCount ?? benchmarkCandles.length,
        )
      : candles,
    [benchmarkCandles, benchmarkStartIndex, benchmarkVisibleCount, candles],
  );

  const meta = getMarketSymbol(symbol);
  const precision = meta?.pricePrecision ?? 2;
  const exchange = meta?.exchange ?? "";
  const displayedIndicators = useMemo(
    () => benchmarkProfile === "phase2"
      ? createPhase2BenchmarkIndicators()
      : benchmarkProfile === "phase3"
        ? []
        : indicators,
    [benchmarkProfile, indicators],
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
    <div className="chart-workspace relative isolate flex h-full min-w-0 w-full flex-col overflow-hidden bg-[var(--chart-bg)]">
      <ChartPerformanceOverlay />
      {/* Chart header: symbol · exchange · TF + OHLC row */}
      <div className="chart-hud pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1.5 rounded-xl border border-terminal-border bg-terminal-panel/82 px-3 py-2 shadow-[0_8px_26px_rgba(0,0,0,.16)] backdrop-blur-md">
        <div className="flex items-center gap-1.5 text-[10px] leading-none text-ink-muted">
          <span className="text-[13px] font-bold tracking-[-0.02em] text-ink">{symbol}</span>
          {exchange && <span>·</span>}
          {exchange && <span>{exchange}</span>}
          <span>·</span>
          <span>{timeframe}</span>
        </div>
        {legend && (
          <div
            className="flex items-center gap-2 text-[10px] font-medium leading-none"
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
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-terminal-bg/55 backdrop-blur-[2px]">
          <div className="flex items-center gap-2 rounded-xl border border-terminal-border bg-terminal-raised px-4 py-3 text-xs font-semibold text-ink-muted shadow-terminal"><Loader2 className="animate-spin text-brand" size={18} /> Loading market data</div>
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
          <ReplaySelectionLayer candidates={displayedCandles} />
        </PriceChart>
        <ReplayFloatingToolbar />
        <RiskPanel />
      </div>

      <ChartTimeToolbar
        chart={mainChart}
        candles={displayedCandles}
        onLoadCandlesAroundTime={
          benchmarkCandles || replayOwnsChart ? undefined : loadCandlesAroundTime
        }
      />
    </div>
  );
}
