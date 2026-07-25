"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaselineSeries,
  CandlestickSeries,
  createChart,
  HistogramSeries,
  LineSeries,
  type AutoscaleInfoProvider,
  type IChartApi,
  type ISeriesApi,
  type Logical,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  Candle,
  IndicatorConfig,
  IndicatorDashboard,
  IndicatorResult,
  IndicatorSeries,
  LoadMoreHistoryResult,
  Timeframe,
} from "@/types";
import { useAtomValue, useSetAtom } from "jotai";
import {
  symbolAtom,
  timeframeAtom,
  activeIndicatorsAtom,
  setCrosshairAtom,
  updateIndicatorAtom,
  removeIndicatorAtom,
  setEditingIndicatorAtom,
  loadPineScriptAtom,
  pineEditorScriptIdAtom,
  pineEditorSourceAtom,
  pineEditorTitleAtom,
} from "@/store/chartStore";
import { setBottomTabAtom, themeAtom, gridVisibleAtom } from "@/store/uiStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { activeChartSlotAtom } from "@/store/replayLayoutStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { indicatorResultValueText } from "@/services/indicatorStyle";
import {
  indicatorSeriesDataForCandles,
  indicatorSeriesDataThroughCutoff,
} from "@/services/indicatorSeriesProjection";
import { chartColors, makeTickMarkFormatter, makeTimeFormatter } from "./chartTheme";
import {
  INDICATOR_PANE_HEIGHT,
  RIGHT_OFFSET_BARS,
  candlestickOptions,
  crosshairOptions,
  gridOptions,
  indicatorSeriesPriceFormatOptions,
  layoutOptions,
  mainPriceScaleOptions,
  panePriceScaleOptions,
  timeScaleDefaults,
  timeScaleOptions,
  volumeAutoscaleInfo,
  volumeScaleCeiling,
} from "./chartVisualProfile";
import { computeCachedIndicator } from "@/services/indicatorComputationCache";
import { getChartOptimizationDecision } from "@/services/chartOptimizationRollout";
import {
  computeIndicator,
  ensureIndicatorRuntimeResult,
  subscribeIndicatorRuntimeCache,
} from "@/services/indicatorRuntimeCache";
import type { IndicatorRuntimeContext } from "@/services/indicatorRuntimePolicy";
import { replayCutoffFromVisibleThrough } from "@/services/indicatorRuntimePolicy";
import { resolveRealtimeSeriesUpdatePlan, type RealtimeSeriesUpdatePlan } from "@/services/market-data/candleSeries";
import { useCountdown } from "@/hooks/useCountdown";
import { useMarketDataStore } from "@/store/marketDataStore";
import { fmtPrice } from "@/utils/format";
import { ChartContextObj, type ChartCtx } from "./ChartContext";
import { setMainChart, setMainChartDefaultViewport } from "./chartRegistry";
import { ChartContextMenu, type ContextMenuState } from "./ChartContextMenu";
import { IndicatorLegend } from "./IndicatorLegend";
import { subscribeChartViewportEvents } from "./chartViewportEvents";
import { installChartViewportController, type ChartViewportController } from "./chartViewportController";
import {
  initialReplayLogicalRange,
  latestReplayLogicalRange,
  shouldInitializeReplayViewport,
  shouldRealignReplayViewport,
} from "./replayViewport";
import { decideAutoFitCandleWindow } from "./chartAutoFitPolicy";
import {
  interpolateReplayCandle,
  replayAppendedCandles,
  replayCandleAnimationDuration,
  replayCandleAnimationStart,
  replayCandlesEqual,
} from "./replayCandlePresentation";
import {
  incrementChartPerformanceCounter,
  measureChartPerformance,
  measureChartSeriesWrite,
} from "@/services/chartPerformanceProbe";
import { installChartBenchmarkHarness } from "@/services/chartBenchmarkHarness";
import { installChartInteractionTestHarness } from "./chartInteractionTestHarness";
import { measureChartPaneMetrics } from "./chartPaneMetrics";
import { crosshairTimeToTimestamp } from "./crosshairSynchronization";
import { removeChartAfterCurrentStack } from "./chartLifecycle";
import {
  beginPriceScalePan,
  continuePriceScalePan,
  endPriceScalePan,
  resetPriceScalePan,
} from "./chartPriceScalePan";
import {
  resolveIndicatorSeriesWritePlan,
  shouldInitializeIndicatorPaneAutoScale,
  type IndicatorWritePoint,
} from "@/services/indicatorSeriesWritePlan";
import { indicatorPointsInViewport, resolveCandleViewport, type CandleViewport } from "@/services/candleViewport";
import type { IndicatorMagnetPoint } from "./drawing/interaction/OhlcMagnetSnap";

function keepLatestBarInView(chart: IChartApi, viewport: ChartViewportController, dataLength: number) {
  const timeScale = chart.timeScale();
  const next = latestReplayLogicalRange(dataLength, timeScale.getVisibleLogicalRange(), RIGHT_OFFSET_BARS);
  if (next) viewport.setLogicalRange(next, "replay-realign");
}

function initializeReplaySessionViewport(viewport: ChartViewportController, dataLength: number) {
  const next = initialReplayLogicalRange(dataLength, RIGHT_OFFSET_BARS);
  if (next) viewport.setLogicalRange(next, "replay-realign");
}

const LEFT_HISTORY_PREFETCH_BARS = 120;

type IndicatorSeriesApi = ISeriesApi<"Line"> | ISeriesApi<"Histogram"> | ISeriesApi<"Baseline">;
type ProjectedIndicatorLabel = {
  key: string;
  text: string;
  color: string;
  backgroundColor?: string;
  style?: string;
  tooltip?: string;
  x: number;
  y: number;
};

function indicatorSeriesAutoscaleOptions(
  series: IndicatorSeries,
  getVolumeCeiling: () => number | undefined,
) {
  if (series.type !== "histogram" || series.valueFormat !== "volume") return {};
  const autoscaleInfoProvider: AutoscaleInfoProvider = (original) =>
    volumeAutoscaleInfo(original(), getVolumeCeiling());
  return { autoscaleInfoProvider };
}

function indicatorStructureSignature(series: readonly IndicatorSeries[]) {
  return series.map((item) => `${item.key}:${item.type ?? "line"}`).join("|");
}

function indicatorStyleSignature(series: IndicatorSeries) {
  return [
    series.color,
    series.lineWidth ?? "",
    series.lineStyle ?? "",
    series.baseValue ?? "",
    series.fillBelowBase ?? "",
    series.lineVisible ?? "",
    series.lastValueVisible ?? "",
    series.precision ?? "",
    series.valueFormat ?? "",
  ].join(":");
}

function labelBackground(color: string | undefined): string {
  return color || "rgba(8, 12, 18, 0.72)";
}

function labelBackgroundIsTransparent(color: string | undefined): boolean {
  if (!color) return false;
  if (color.trim().toLowerCase() === "transparent") return true;
  const transparentRgba = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/i);
  return transparentRgba != null && Number(transparentRgba[1]) < 0.08;
}

function rebuildCandleLookup(candles: readonly Candle[]): Map<number, Candle> {
  return new Map(candles.map((candle) => [candle.time, candle]));
}

function updateCandleLookup(
  lookup: Map<number, Candle>,
  candles: readonly Candle[],
  updatePlan: RealtimeSeriesUpdatePlan,
): Map<number, Candle> {
  if (candles.length === 0) return new Map();
  if (updatePlan === "update-latest") {
    const last = candles[candles.length - 1];
    lookup.set(last.time, last);
    return lookup;
  }
  if (updatePlan === "append") {
    const penult = candles[candles.length - 2];
    const last = candles[candles.length - 1];
    if (penult) lookup.set(penult.time, penult);
    lookup.set(last.time, last);
    return lookup;
  }
  return rebuildCandleLookup(candles);
}

function logicalRangeAfterDataReplacement(
  range: LogicalRange | null,
  previous: readonly Candle[],
  next: readonly Candle[],
): LogicalRange | null {
  if (!range || previous.length === 0 || next.length === 0) return null;
  const previousFirstTime = previous[0]?.time;
  if (previousFirstTime == null) return range;
  const nextIndexOfPreviousFirst = next.findIndex((candle) => candle.time === previousFirstTime);
  if (nextIndexOfPreviousFirst < 0) return null;
  if (nextIndexOfPreviousFirst === 0) return range;
  return {
    from: (Number(range.from) + nextIndexOfPreviousFirst) as Logical,
    to: (Number(range.to) + nextIndexOfPreviousFirst) as Logical,
  };
}

function candleWindowsOverlap(
  previous: readonly Candle[],
  next: readonly Candle[],
): boolean {
  const previousFirst = previous[0]?.time;
  const previousLast = previous.at(-1)?.time;
  const nextFirst = next[0]?.time;
  const nextLast = next.at(-1)?.time;
  if (
    previousFirst == null ||
    previousLast == null ||
    nextFirst == null ||
    nextLast == null
  ) {
    return false;
  }
  return previousFirst <= nextLast && nextFirst <= previousLast;
}

/**
 * Main candlestick chart. Plots the supplied (replay-aware) candles, overlays
 * non-pane indicators, reports the crosshair, and exposes an imperative
 * ChartContext so overlay layers (drawings, SMC) can convert price/time to
 * pixel coordinates and repaint in lock-step with pan/zoom.
 */
export function PriceChart({
  candles,
  indicatorsOverride,
  children,
  onLoadMoreHistory,
  onReady,
  timeZone,
  symbolOverride,
  timeframeOverride,
  replayTrackSlot = 0,
  interactive = true,
  registerAsMain = true,
}: {
  candles: Candle[];
  indicatorsOverride?: IndicatorConfig[];
  children?: React.ReactNode;
  onLoadMoreHistory?: () => Promise<LoadMoreHistoryResult | void> | LoadMoreHistoryResult | void;
  onReady?: (chart: IChartApi | null) => void;
  timeZone?: string;
  symbolOverride?: string;
  timeframeOverride?: Timeframe;
  replayTrackSlot?: number;
  interactive?: boolean;
  registerAsMain?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const viewportControllerRef = useRef<ChartViewportController | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const indSeriesRef = useRef<Map<string, IndicatorSeriesApi[]>>(new Map());
  const indStructureRef = useRef<Map<string, string>>(new Map());
  const indStyleRef = useRef<Map<string, string>>(new Map());
  const indDataRef = useRef<Map<string, IndicatorWritePoint[]>>(new Map());
  const indVolumeCeilingRef = useRef<Map<string, number>>(new Map());
  const paneLayoutSignatureRef = useRef("");
  const fittedRef = useRef(false);
  const lastAutoFitLengthRef = useRef(0);
  const pendingMarketViewportResetRef = useRef(true);
  const initializedReplaySessionRef = useRef<string | null>(null);
  const activeReplaySessionRef = useRef<string | null>(null);
  const prevCandlesRef = useRef<Candle[]>([]);
  const candleByTimeRef = useRef<Map<number, Candle>>(new Map());
  const prevThemeRef = useRef<string>("");
  const appliedTimeframeRef = useRef<Timeframe | null>(null);
  const bumpRafRef = useRef<number | null>(null);
  const candleAnimationRafRef = useRef<number | null>(null);
  const autoFitRafRef = useRef<number | null>(null);
  const replayViewportInitRafRef = useRef<number | null>(null);
  const historyPrependViewportRafRef = useRef<number | null>(null);
  const renderedLatestCandleRef = useRef<Candle | null>(null);
  const renderedCandleCountRef = useRef(0);
  const prevMarkerPriceRef = useRef<number | null>(null);
  const markerUpRef = useRef(true);
  const candlesRef = useRef<Candle[]>(candles);
  const loadMoreHistoryRef = useRef(onLoadMoreHistory);
  const loadMoreInFlightRef = useRef(false);
  const loadMoreGenerationRef = useRef(0);
  const lastLoadMoreFirstTimeRef = useRef<number | null>(null);
  const indicatorViewportRef = useRef<CandleViewport | null>(null);
  const visibleLogicalRangeRef = useRef<LogicalRange | null>(null);
  const derivedDataEnabledRef = useRef(true);
  const lastCrosshairTimeRef = useRef<number | null>(null);

  const theme = useAtomValue(themeAtom);
  const gridVisible = useAtomValue(gridVisibleAtom);
  const replayProjection = useReplayClientProjection();
  const replaySnapshot = replayProjection.snapshot;
  const activeChartSlot = useAtomValue(activeChartSlotAtom);
  const replayTrack = replaySnapshot?.mode === "single_chart"
    ? replayTrackSlot === activeChartSlot
      ? replaySnapshot.tracks[0]
      : undefined
    : replaySnapshot?.tracks.find((track) => track.slot === replayTrackSlot);
  const replaySessionId = replayTrack ? replaySnapshot?.id ?? null : null;
  activeReplaySessionRef.current = replaySessionId;
  const replayActive = Boolean(replayTrack);
  const replayPlaying = replayActive && replaySnapshot?.status === "playing";
  const replaySpeed = replaySnapshot?.speed ?? 1;
  const storedSymbol = useAtomValue(symbolAtom);
  const storedTimeframe = useAtomValue(timeframeAtom);
  const symbol = symbolOverride ?? storedSymbol;
  const timeframe = timeframeOverride ?? storedTimeframe;
  const indicatorRuntimeContext = useMemo<IndicatorRuntimeContext>(() => {
    const context: IndicatorRuntimeContext = { symbol, timeframe };
    if (!replayActive || !replaySessionId) return context;
    const replayCutoff = replayCutoffFromVisibleThrough(
      replayTrack?.visibleThrough,
    );
    return replayCutoff == null
      ? { ...context, replaySessionId }
      : { ...context, replaySessionId, replayCutoff };
  }, [replayActive, replaySessionId, replayTrack?.visibleThrough, symbol, timeframe]);
  const storedIndicators = useAtomValue(activeIndicatorsAtom);
  const indicators = indicatorsOverride ?? storedIndicators;
  const setCrosshair = useSetAtom(setCrosshairAtom);
  const updateIndicator = useSetAtom(updateIndicatorAtom);
  const removeIndicator = useSetAtom(removeIndicatorAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const loadPineScript = useSetAtom(loadPineScriptAtom);
  const setPineEditorScriptId = useSetAtom(pineEditorScriptIdAtom);
  const setPineEditorTitle = useSetAtom(pineEditorTitleAtom);
  const setPineEditorSource = useSetAtom(pineEditorSourceAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);

  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [indicatorViewport, setIndicatorViewport] = useState<CandleViewport | null>(null);
  const [priceMarker, setPriceMarker] = useState<CurrentPriceMarkerState | null>(null);
  const [indicatorLabels, setIndicatorLabels] = useState<ProjectedIndicatorLabel[]>([]);
  const [indicatorDashboards, setIndicatorDashboards] = useState<IndicatorDashboard[]>([]);
  const [pineRuntimeVersion, setPineRuntimeVersion] = useState(0);
  const marketSymbol = getMarketSymbol(symbol);
  const sessionStatus = useMarketDataStore(
    (s) => s.marketSessions[symbol.trim().toUpperCase()],
  );
  const countdown = useCountdown(
    timeframe,
    candles[candles.length - 1]?.time,
    // Missing status means the backend has not supplied an authoritative
    // session feed yet; retain the candle-clock fallback instead of hiding the
    // countdown. An explicit closed/unknown status still suppresses it.
    marketSymbol?.provider === "mt5" ? sessionStatus : undefined,
  );
  const lastQuote = useMarketDataStore((s) => s.quotes[symbol]);
  const precision = marketSymbol?.pricePrecision ?? 2;
  const optimizationDecision = getChartOptimizationDecision(candles.length);
  derivedDataEnabledRef.current = optimizationDecision.derivedData;

  const scheduleVersionBump = useCallback(() => {
    incrementChartPerformanceCounter("viewport.notifications");
    if (bumpRafRef.current !== null) {
      incrementChartPerformanceCounter("viewport.coalesced");
      return;
    }
    bumpRafRef.current = requestAnimationFrame(() => {
      incrementChartPerformanceCounter("viewport.frames");
      bumpRafRef.current = null;
      const range = chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
      visibleLogicalRangeRef.current = range;
      const activeChart = chartRef.current;
      if (activeChart) {
        const paneMetrics = measureChartPaneMetrics(activeChart);
        incrementChartPerformanceCounter("pane.width.samples");
        if (paneMetrics.widthDrift > 1) {
          incrementChartPerformanceCounter("pane.width.mismatches");
        }
      }
      if (derivedDataEnabledRef.current) {
        const previousViewport = indicatorViewportRef.current;
        const nextViewport = resolveCandleViewport(candlesRef.current.length, range, previousViewport);
        indicatorViewportRef.current = nextViewport;
        if (nextViewport?.revision !== previousViewport?.revision) {
          incrementChartPerformanceCounter("indicator.viewport.windowShifts");
          setIndicatorViewport(nextViewport);
        } else if (nextViewport) {
          incrementChartPerformanceCounter("indicator.viewport.windowRetained");
        }
      }
      setVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    prevMarkerPriceRef.current = null;
    markerUpRef.current = true;
    loadMoreGenerationRef.current += 1;
    loadMoreInFlightRef.current = false;
    lastLoadMoreFirstTimeRef.current = null;
    indicatorViewportRef.current = null;
    visibleLogicalRangeRef.current = null;
    fittedRef.current = false;
    lastAutoFitLengthRef.current = 0;
    pendingMarketViewportResetRef.current = true;
    const chart = chartRef.current;
    if (chart) resetPriceScalePan(chart);
    if (autoFitRafRef.current !== null) {
      cancelAnimationFrame(autoFitRafRef.current);
      autoFitRafRef.current = null;
    }
    if (historyPrependViewportRafRef.current !== null) {
      cancelAnimationFrame(historyPrependViewportRafRef.current);
      historyPrependViewportRafRef.current = null;
    }
    setIndicatorViewport(null);
  }, [symbol, timeframe]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    loadMoreHistoryRef.current = onLoadMoreHistory;
  }, [onLoadMoreHistory]);

  // ---- Create chart once ----
  useEffect(() => {
    if (!containerRef.current) return;
    const chartContainer = containerRef.current;
    const initialBounds = chartContainer.getBoundingClientRect();
    const defaultViewport = timeScaleDefaults(timeframe);
    if (registerAsMain) setMainChartDefaultViewport(defaultViewport);
    appliedTimeframeRef.current = timeframe;
    const chart = createChart(chartContainer, {
      autoSize: false,
      width: Math.max(1, Math.floor(initialBounds.width)),
      height: Math.max(1, Math.floor(initialBounds.height)),
      layout: {
        ...layoutOptions(theme),
        panes: {
          separatorColor: chartColors(theme).border,
          separatorHoverColor: chartColors(theme).crosshair,
          enableResize: true,
        },
      },
      grid: gridOptions(theme, gridVisible),
      rightPriceScale: mainPriceScaleOptions(theme),
      leftPriceScale: { visible: false },
      timeScale: timeScaleOptions(theme, timeframe, timeZone),
      localization: {
        // Floating crosshair time tooltip — HH:mm intraday, date for daily.
        timeFormatter: makeTimeFormatter(timeframe, timeZone),
      },
      crosshair: crosshairOptions(theme),
      handleScroll: {
        mouseWheel: interactive,
        pressedMouseMove: interactive,
        horzTouchDrag: interactive,
        vertTouchDrag: interactive,
      },
      handleScale: {
        mouseWheel: interactive,
        pinch: interactive,
        axisPressedMouseMove: interactive,
        axisDoubleClickReset: interactive,
      },
      kineticScroll: {
        // TradingView desktop pan stops when the mouse is released. Keep touch
        // inertia for mobile, but do not let a mouse drag coast across candles.
        mouse: false,
        touch: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, candlestickOptions(theme, precision));

    chartRef.current = chart;
    const viewportController = installChartViewportController(chart);
    viewportControllerRef.current = viewportController;
    candleSeriesRef.current = candleSeries;
    setReady(true);
    if (registerAsMain) setMainChart(chart);
    onReady?.(chart);

    let disposed = false;
    const unsubscribeViewportEvents = subscribeChartViewportEvents(chart, (source) => {
      if (disposed) return;
      if (source === "input") viewportController.beginUserInteraction();
      scheduleVersionBump();
    });
    const handlePriceScalePanStart = (event: PointerEvent) => {
      if (interactive) beginPriceScalePan(chart, event);
    };
    const handlePriceScalePanMove = (event: PointerEvent) => {
      if (interactive) continuePriceScalePan(chart, event);
    };
    const handlePriceScalePanEnd = (event: PointerEvent) => {
      if (interactive) endPriceScalePan(chart, event);
    };
    const handlePriceScalePanBlur = () => endPriceScalePan(chart);
    chartContainer.addEventListener("pointerdown", handlePriceScalePanStart, true);
    chartContainer.addEventListener("pointermove", handlePriceScalePanMove, true);
    window.addEventListener("pointerup", handlePriceScalePanEnd, true);
    window.addEventListener("pointercancel", handlePriceScalePanEnd, true);
    window.addEventListener("blur", handlePriceScalePanBlur);
    const uninstallBenchmarkHarness = interactive
      ? installChartBenchmarkHarness(chart, () => candlesRef.current.length)
      : () => undefined;
    const uninstallInteractionHarness = interactive
      ? installChartInteractionTestHarness({
          chart,
          viewport: viewportController,
          candleCount: () => candlesRef.current.length,
          firstCandleTime: () => candlesRef.current[0]?.time ?? null,
          lastCrosshairTime: () => lastCrosshairTimeRef.current,
        })
      : () => undefined;

    const handleCrosshairMove: Parameters<IChartApi["subscribeCrosshairMove"]>[0] = (param) => {
      if (disposed) return;
      const timestamp = crosshairTimeToTimestamp(param.time);
      lastCrosshairTimeRef.current = timestamp;
      if (timestamp == null) {
        setCrosshair(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as Candle | undefined;
      const sourceCandle = candleByTimeRef.current.get(timestamp);
      setCrosshair({
        time: timestamp,
        candle: data
          ? {
              ...(sourceCandle ?? data),
              ...data,
              volume: sourceCandle?.volume ?? 0,
            }
          : null,
      });
    };

    const ro = new ResizeObserver((entries) => {
      if (disposed || chartRef.current !== chart) return;
      const bounds = entries[0]?.contentRect;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
      chart.resize(Math.floor(bounds.width), Math.floor(bounds.height));
      scheduleVersionBump();
    });
    if (interactive) chart.subscribeCrosshairMove(handleCrosshairMove);
    ro.observe(chartContainer);

    const indStore = indSeriesRef.current;
    const indStructureStore = indStructureRef.current;
    const indStyleStore = indStyleRef.current;
    const indDataStore = indDataRef.current;
    const indVolumeCeilingStore = indVolumeCeilingRef.current;
    return () => {
      disposed = true;
      ro.disconnect();
      uninstallInteractionHarness();
      uninstallBenchmarkHarness();
      unsubscribeViewportEvents();
      chartContainer.removeEventListener("pointerdown", handlePriceScalePanStart, true);
      chartContainer.removeEventListener("pointermove", handlePriceScalePanMove, true);
      window.removeEventListener("pointerup", handlePriceScalePanEnd, true);
      window.removeEventListener("pointercancel", handlePriceScalePanEnd, true);
      window.removeEventListener("blur", handlePriceScalePanBlur);
      endPriceScalePan(chart);
      if (interactive) chart.unsubscribeCrosshairMove(handleCrosshairMove);
      if (bumpRafRef.current !== null) {
        cancelAnimationFrame(bumpRafRef.current);
        bumpRafRef.current = null;
      }
      if (candleAnimationRafRef.current !== null) {
        cancelAnimationFrame(candleAnimationRafRef.current);
        candleAnimationRafRef.current = null;
      }
      if (autoFitRafRef.current !== null) {
        cancelAnimationFrame(autoFitRafRef.current);
        autoFitRafRef.current = null;
      }
      if (replayViewportInitRafRef.current !== null) {
        cancelAnimationFrame(replayViewportInitRafRef.current);
        replayViewportInitRafRef.current = null;
      }
      if (historyPrependViewportRafRef.current !== null) {
        cancelAnimationFrame(historyPrependViewportRafRef.current);
        historyPrependViewportRafRef.current = null;
      }
      chartRef.current = null;
      candleSeriesRef.current = null;
      if (registerAsMain) setMainChart(null);
      onReady?.(null);
      viewportController.destroy();
      viewportControllerRef.current = null;
      indStore.clear();
      indStructureStore.clear();
      indStyleStore.clear();
      indDataStore.clear();
      indVolumeCeilingStore.clear();
      setReady(false);
      removeChartAfterCurrentStack(chart);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;

    const maybeLoadOlderHistory = () => {
      const loadMore = loadMoreHistoryRef.current;
      if (!loadMore || loadMoreInFlightRef.current) return;

      const range = chart.timeScale().getVisibleLogicalRange();
      const first = candlesRef.current[0];
      if (!range || !first) return;
      const candleSeries = candleSeriesRef.current;
      const barsInfo = candleSeries?.barsInLogicalRange(range);
      const barsBefore = barsInfo?.barsBefore ?? range.from;
      if (barsBefore > LEFT_HISTORY_PREFETCH_BARS) return;
      if (lastLoadMoreFirstTimeRef.current === first.time) return;

      const generation = loadMoreGenerationRef.current;
      lastLoadMoreFirstTimeRef.current = first.time;
      loadMoreInFlightRef.current = true;
      // Start in a microtask so synchronous callback throws are also handled.
      Promise.resolve()
        .then(() => loadMore())
        .then((result) => {
          if (generation !== loadMoreGenerationRef.current) return;
          if (result?.status !== "exhausted") {
            // `retry` (including a not-ready/no-op response) must allow the
            // same cursor to be attempted again on the next range notification.
            lastLoadMoreFirstTimeRef.current = null;
          }
        })
        .catch(() => {
          if (generation === loadMoreGenerationRef.current) {
            lastLoadMoreFirstTimeRef.current = null;
          }
        })
        .finally(() => {
          if (generation === loadMoreGenerationRef.current) {
            loadMoreInFlightRef.current = false;
          }
        });
    };

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(maybeLoadOlderHistory);
    maybeLoadOlderHistory();
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(maybeLoadOlderHistory);
  }, [candles.length, onLoadMoreHistory, ready, symbol, timeframe]);

  // ---- Re-theme / grid toggle / timeframe-aware time format ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = chartColors(theme);
    const timeframeChanged = appliedTimeframeRef.current !== timeframe;
    const defaultViewport = timeScaleDefaults(timeframe);
    if (timeframeChanged) {
      if (registerAsMain) setMainChartDefaultViewport(defaultViewport);
      appliedTimeframeRef.current = timeframe;
    }
    chart.applyOptions({
      layout: {
        ...layoutOptions(theme),
        panes: {
          separatorColor: c.border,
          separatorHoverColor: c.crosshair,
          enableResize: true,
        },
      },
      grid: gridOptions(theme, gridVisible),
      rightPriceScale: mainPriceScaleOptions(theme),
      timeScale: {
        ...(timeframeChanged
          ? timeScaleOptions(theme, timeframe, timeZone)
          : {
              borderColor: c.border,
              tickMarkFormatter: makeTickMarkFormatter(timeZone),
            }),
        ...(timeframeChanged ? defaultViewport : {}),
        rightBarStaysOnScroll: true,
        shiftVisibleRangeOnNewBar: true,
        allowShiftVisibleRangeOnWhitespaceReplacement: false,
      },
      localization: { timeFormatter: makeTimeFormatter(timeframe, timeZone) },
      crosshair: crosshairOptions(theme),
    });
    candleSeriesRef.current?.applyOptions(candlestickOptions(theme, precision));
  }, [gridVisible, precision, registerAsMain, theme, timeZone, timeframe]);

  // ---- Push candle data ----
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs) return;
    const setCandleData = (source: readonly Candle[]) => {
      const data = measureChartPerformance(
        "candle.projection",
        () =>
          source.map((candle) => ({
            time: candle.time as UTCTimestamp,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          })),
        { candles: source.length },
      );
      measureChartSeriesWrite("candle", "setData", data.length, () => cs.setData(data));
    };
    const updateCandle = (candle: Candle) =>
      measureChartSeriesWrite("candle", "update", 1, () =>
        cs.update({
          time: candle.time as UTCTimestamp,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        }),
      );
    const animationWasRunning = candleAnimationRafRef.current !== null;
    if (candleAnimationRafRef.current !== null) {
      cancelAnimationFrame(candleAnimationRafRef.current);
      candleAnimationRafRef.current = null;
    }

    // Pause means freeze the candle exactly where the user pressed the button.
    // The authoritative candle batch is already in `candles`, so applying it
    // here would make the remaining candles appear after playback was paused.
    if (replayActive && !replayPlaying && animationWasRunning) {
      const renderedCount = Math.min(renderedCandleCountRef.current, candles.length);
      const renderedLatest = renderedLatestCandleRef.current;
      if (renderedCount > 0 && renderedLatest) {
        prevCandlesRef.current = [...candles.slice(0, renderedCount - 1), renderedLatest];
      }
      prevThemeRef.current = theme;
      scheduleVersionBump();
      return;
    }
    // Empty series => symbol/timeframe changed or a Replay track is between its
    // reset and hydration events. The next non-empty Replay window must get its
    // stable logical span again, even when the backend keeps the same session id.
    if (candles.length === 0) {
      fittedRef.current = false;
      lastAutoFitLengthRef.current = 0;
      initializedReplaySessionRef.current = null;
      if (replayViewportInitRafRef.current !== null) {
        cancelAnimationFrame(replayViewportInitRafRef.current);
        replayViewportInitRafRef.current = null;
      }
    }
    const c = chartColors(theme);

    const prev = prevCandlesRef.current;
    const last = candles[candles.length - 1];

    // Realtime fast path: a forming-bar tick (same length, same last time) or a
    // single appended bar → series.update() instead of a full setData. Smooth
    // O(1) updates (TradingView-style). Anything else (symbol/timeframe change,
    // history load, replay slice, theme change) → setData.
    const sameTheme = prevThemeRef.current === theme;
    const updatePlan = resolveRealtimeSeriesUpdatePlan(prev, candles, sameTheme);
    const replayBurst = replayPlaying && sameTheme ? replayAppendedCandles(prev, candles) : null;
    const structuralDataWindowChange = sameTheme && prev.length > 0 && candles.length > 0 && updatePlan === "replace";
    const dataWindowReset =
      structuralDataWindowChange && !candleWindowsOverlap(prev, candles);
    const visibleRangeBeforeReplace =
      structuralDataWindowChange && !dataWindowReset && fittedRef.current
        ? chartRef.current?.timeScale().getVisibleLogicalRange()
        : null;
    candleByTimeRef.current = updateCandleLookup(candleByTimeRef.current, candles, updatePlan);

    if (replayActive && !replayPlaying && renderedCandleCountRef.current !== candles.length) {
      setCandleData(candles);
      renderedLatestCandleRef.current = last ?? null;
      renderedCandleCountRef.current = candles.length;
    } else if (replayBurst) {
      // A backend clock commit finalizes the overlapping forming bar, then
      // appends one or more newly revealed bars. Present only those new bars
      // at the selected updates-per-second rate.
      setCandleData(prev);
      const finalizedPrevious = candles[prev.length - 1];
      if (finalizedPrevious?.time === prev.at(-1)?.time) {
        updateCandle(finalizedPrevious);
        renderedLatestCandleRef.current = finalizedPrevious;
      }
      renderedCandleCountRef.current = prev.length;
      const duration = replayCandleAnimationDuration(replaySpeed);
      let burstIndex = 0;
      let target = replayBurst[burstIndex]!;
      let start = replayCandleAnimationStart(null, target);
      let startedAt: number | null = null;
      const updateRendered = (candle: Candle) => {
        updateCandle(candle);
        renderedLatestCandleRef.current = candle;
      };
      const renderBurstFrame = (now: number) => {
        if (startedAt == null) startedAt = now;
        const progress = (now - startedAt) / duration;
        updateRendered(interpolateReplayCandle(start, target, progress));
        scheduleVersionBump();
        if (progress < 1) {
          candleAnimationRafRef.current = requestAnimationFrame(renderBurstFrame);
          return;
        }
        burstIndex += 1;
        if (burstIndex >= replayBurst.length) {
          renderedCandleCountRef.current = candles.length;
          candleAnimationRafRef.current = null;
          return;
        }
        target = replayBurst[burstIndex]!;
        start = replayCandleAnimationStart(null, target);
        startedAt = null;
        updateRendered(start);
        renderedCandleCountRef.current = prev.length + burstIndex + 1;
        candleAnimationRafRef.current = requestAnimationFrame(renderBurstFrame);
      };
      updateRendered(start);
      renderedCandleCountRef.current = prev.length + 1;
      candleAnimationRafRef.current = requestAnimationFrame(renderBurstFrame);
    } else if (updatePlan === "update-latest" || updatePlan === "append") {
      // On append, finalize the previously-forming (now penultimate) bar first.
      if (updatePlan === "append") {
        const penult = candles[candles.length - 2];
        updateCandle(penult);
      }
      const target = last!;
      const start = replayCandleAnimationStart(renderedLatestCandleRef.current, target);
      if (replayPlaying && !replayCandlesEqual(start, target)) {
        const duration = replayCandleAnimationDuration(replaySpeed);
        let startedAt: number | null = null;
        const renderFrame = (now: number) => {
          if (startedAt == null) startedAt = now;
          const rendered = interpolateReplayCandle(start, target, (now - startedAt) / duration);
          updateCandle(rendered);
          renderedLatestCandleRef.current = rendered;
          scheduleVersionBump();
          if (!replayCandlesEqual(rendered, target)) {
            candleAnimationRafRef.current = requestAnimationFrame(renderFrame);
          } else {
            candleAnimationRafRef.current = null;
          }
        };
        updateCandle(start);
        renderedLatestCandleRef.current = start;
        candleAnimationRafRef.current = requestAnimationFrame(renderFrame);
      } else {
        updateCandle(target);
        renderedLatestCandleRef.current = target;
      }
      renderedCandleCountRef.current = candles.length;
    } else {
      setCandleData(candles);
      renderedLatestCandleRef.current = last ?? null;
      renderedCandleCountRef.current = candles.length;
      const restoredRange = logicalRangeAfterDataReplacement(visibleRangeBeforeReplace ?? null, prev, candles);
      if (restoredRange) {
        if (historyPrependViewportRafRef.current !== null) {
          cancelAnimationFrame(historyPrependViewportRafRef.current);
          historyPrependViewportRafRef.current = null;
        }
        const viewport = viewportControllerRef.current;
        const revision = viewport?.snapshot().revision;
        const frame = requestAnimationFrame(() => {
          if (historyPrependViewportRafRef.current !== frame) return;
          historyPrependViewportRafRef.current = null;
          if (viewportControllerRef.current !== viewport) return;
          if (viewport && revision != null) {
            viewport.setLogicalRangeIfRevision(restoredRange, "history-prepend", revision);
            return;
          }
          viewport?.setLogicalRange(restoredRange, "history-prepend");
        });
        historyPrependViewportRafRef.current = frame;
      }
    }

    prevCandlesRef.current = candles;
    prevThemeRef.current = theme;
    if (last) {
      cs.applyOptions({
        priceLineColor: last.close >= last.open ? c.bull : c.bear,
      });
    }

    // Fit the time scale once on the first non-empty load; afterwards leave the
    // user's pan/zoom intact for realtime ticks and one-by-one replay playback.
    const autoFit = decideAutoFitCandleWindow({
      previousLength: prev.length,
      nextLength: candles.length,
      alreadyFitted: fittedRef.current,
      lastAutoFitLength: lastAutoFitLengthRef.current,
      structuralDataWindowChange,
      dataWindowReset,
      replayActive,
    });

    const initializeReplayViewport = shouldInitializeReplayViewport(
      replaySessionId,
      initializedReplaySessionRef.current,
      candles.length,
    );

    const resetToLatestMarket =
      pendingMarketViewportResetRef.current &&
      candles.length > 0 &&
      !replayActive;

    if (resetToLatestMarket) {
      pendingMarketViewportResetRef.current = false;
      lastAutoFitLengthRef.current = candles.length;
      fittedRef.current = true;
      viewportControllerRef.current?.reset(
        timeScaleDefaults(timeframe),
        "market-change",
      );
    } else if (initializeReplayViewport && replaySessionId) {
      initializedReplaySessionRef.current = replaySessionId;
      lastAutoFitLengthRef.current = candles.length;
      fittedRef.current = true;
      const viewport = viewportControllerRef.current;
      if (replayViewportInitRafRef.current !== null) {
        cancelAnimationFrame(replayViewportInitRafRef.current);
      }
      const frame = requestAnimationFrame(() => {
        if (replayViewportInitRafRef.current !== frame) return;
        replayViewportInitRafRef.current = null;
        if (activeReplaySessionRef.current !== replaySessionId || viewportControllerRef.current !== viewport) return;
        if (viewport) {
          initializeReplaySessionViewport(viewport, candlesRef.current.length);
        }
      });
      replayViewportInitRafRef.current = frame;
    } else if (autoFit.fitContent) {
      lastAutoFitLengthRef.current = candles.length;
      fittedRef.current = autoFit.markComplete;
      const viewport = viewportControllerRef.current;
      if (dataWindowReset && viewport) {
        // The indicator effects run after this candle effect. A disjoint candle
        // replacement can therefore coexist for one commit with indicator
        // series from the old timeline; fitting synchronously would include
        // those stale points and keep the new candles offscreen after cleanup.
        // Defer one frame so all series have reconciled, while retaining the
        // usual revision/data guards against overriding newer user input.
        if (autoFitRafRef.current !== null) {
          cancelAnimationFrame(autoFitRafRef.current);
        }
        const scheduledSnapshot = viewport.snapshot();
        const expectedFirstTime = candles[0]?.time;
        const expectedLastTime = candles.at(-1)?.time;
        const frame = requestAnimationFrame(() => {
          if (autoFitRafRef.current !== frame) return;
          autoFitRafRef.current = null;
          const currentCandles = candlesRef.current;
          const currentViewport = viewport.snapshot();
          const supersededByProgrammaticWrite =
            currentViewport.programmaticWrites !== scheduledSnapshot.programmaticWrites;
          const supersededByUserInput =
            currentViewport.revision !== scheduledSnapshot.revision &&
            currentViewport.cause === "user";
          if (
            viewportControllerRef.current !== viewport ||
            supersededByProgrammaticWrite ||
            supersededByUserInput ||
            currentCandles[0]?.time !== expectedFirstTime ||
            currentCandles.at(-1)?.time !== expectedLastTime
          ) {
            return;
          }
          viewport.fitContent("initial-fit");
        });
        autoFitRafRef.current = frame;
      } else {
        viewport?.fitContent("initial-fit");
      }
    } else if (
      replayActive &&
      shouldRealignReplayViewport(chartRef.current?.timeScale().getVisibleLogicalRange(), candles.length)
    ) {
      const dataLength = candles.length;
      requestAnimationFrame(() => {
        const chart = chartRef.current;
        if (!chart) return;
        if (replayActive && shouldRealignReplayViewport(chart.timeScale().getVisibleLogicalRange(), dataLength)) {
          const viewport = viewportControllerRef.current;
          if (viewport) keepLatestBarInView(chart, viewport, dataLength);
        }
      });
    }
    scheduleVersionBump();
  }, [
    candles,
    replayActive,
    replayPlaying,
    replaySessionId,
    replaySpeed,
    scheduleVersionBump,
    symbol,
    theme,
    timeframe,
  ]);

  // ---- Overlay indicators (backend-runtime results) ----
  const overlayIndicators = useMemo(
    () => indicators.filter((i) => i.visible !== false && !i.separatePane),
    [indicators],
  );
  const paneIndicators = useMemo(() => indicators.filter((i) => i.separatePane), [indicators]);
  const visiblePaneIndicators = useMemo(() => paneIndicators.filter((i) => i.visible !== false), [paneIndicators]);
  const overlayLegendIndicators = useMemo(() => indicators.filter((i) => !i.separatePane), [indicators]);
  useEffect(() => {
    const onRuntimeUpdate = () => setPineRuntimeVersion((value) => value + 1);
    return subscribeIndicatorRuntimeCache(onRuntimeUpdate);
  }, []);
  useEffect(() => {
    [...overlayIndicators, ...visiblePaneIndicators].forEach((cfg) => {
      ensureIndicatorRuntimeResult(cfg, candles, indicatorRuntimeContext);
    });
  }, [overlayIndicators, visiblePaneIndicators, candles, indicatorRuntimeContext]);
  const overlayResults = useMemo(() => {
    void pineRuntimeVersion;
    return overlayIndicators.map((cfg) => ({
      cfg,
      result: optimizationDecision.derivedData
        ? computeCachedIndicator(cfg, candles, indicatorRuntimeContext, pineRuntimeVersion)
        : computeIndicator(cfg, candles, indicatorRuntimeContext),
    }));
  }, [overlayIndicators, candles, indicatorRuntimeContext, optimizationDecision.derivedData, pineRuntimeVersion]);
  const paneResults = useMemo(() => {
    void pineRuntimeVersion;
    return visiblePaneIndicators.map((cfg) => ({
      cfg,
      result: optimizationDecision.derivedData
        ? computeCachedIndicator(cfg, candles, indicatorRuntimeContext, pineRuntimeVersion)
        : computeIndicator(cfg, candles, indicatorRuntimeContext),
    }));
  }, [visiblePaneIndicators, candles, indicatorRuntimeContext, optimizationDecision.derivedData, pineRuntimeVersion]);
  const chartIndicatorResults = useMemo(() => [...overlayResults, ...paneResults], [overlayResults, paneResults]);
  const indicatorMagnetPoints = useMemo<IndicatorMagnetPoint[]>(
    () =>
      overlayResults.flatMap(({ cfg, result }) =>
        result.series.flatMap((series) =>
          series.data.flatMap((point) =>
            Number.isFinite(point.time) &&
            Number.isFinite(point.value) &&
            (indicatorRuntimeContext.replayCutoff == null ||
              point.time <= indicatorRuntimeContext.replayCutoff)
              ? [
                  {
                    time: point.time,
                    value: point.value,
                    sourceId: cfg.id,
                    seriesKey: series.key,
                  },
                ]
              : [],
          ),
        ),
      ),
    [indicatorRuntimeContext.replayCutoff, overlayResults],
  );
  const overlayLegendValueText = useMemo(
    () => Object.fromEntries(overlayResults.map(({ cfg, result }) => [cfg.id, indicatorResultValueText(result)])),
    [overlayResults],
  );
  const paneLegendValueText = useMemo(
    () => Object.fromEntries(paneResults.map(({ cfg, result }) => [cfg.id, indicatorResultValueText(result)])),
    [paneResults],
  );

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const store = indSeriesRef.current;
    const paneLayoutSignature = paneIndicators.map((item) => item.id).join("|");
    if (paneLayoutSignatureRef.current !== paneLayoutSignature) {
      for (const series of store.values()) {
        series.forEach((item) => chart.removeSeries(item));
      }
      store.clear();
      indStructureRef.current.clear();
      indStyleRef.current.clear();
      indDataRef.current.clear();
      indVolumeCeilingRef.current.clear();
      while (chart.panes().length > 1) {
        chart.removePane(chart.panes().length - 1);
      }
      paneIndicators.forEach(() => chart.addPane(true));
      chart
        .panes()
        .slice(1)
        .forEach((pane) => {
          pane.setPreserveEmptyPane(true);
          pane.setHeight(INDICATOR_PANE_HEIGHT);
        });
      paneLayoutSignatureRef.current = paneLayoutSignature;
      setVersion((value) => value + 1);
    }
    chart
      .panes()
      .slice(1)
      .forEach((pane, index) => {
        pane.setPreserveEmptyPane(true);
        chart.priceScale("right", index + 1).applyOptions(panePriceScaleOptions(theme));
      });

    const activeIds = new Set(chartIndicatorResults.map((item) => item.cfg.id));

    // Remove series for indicators no longer present.
    for (const [id, series] of store) {
      if (!activeIds.has(id)) {
        series.forEach((s) => chart.removeSeries(s));
        store.delete(id);
        indStructureRef.current.delete(id);
        for (const key of [...indStyleRef.current.keys()]) {
          if (key.startsWith(`${id}:`)) indStyleRef.current.delete(key);
        }
        for (const key of [...indDataRef.current.keys()]) {
          if (key.startsWith(`${id}:`)) indDataRef.current.delete(key);
        }
        for (const key of [...indVolumeCeilingRef.current.keys()]) {
          if (key.startsWith(`${id}:`)) indVolumeCeilingRef.current.delete(key);
        }
      }
    }

    for (const { cfg, result } of chartIndicatorResults) {
      let series = store.get(cfg.id);
      const paneIndex = cfg.separatePane ? paneIndicators.findIndex((item) => item.id === cfg.id) + 1 : 0;
      const structureSignature = `${paneIndex}:${indicatorStructureSignature(result.series)}`;
      const structureChanged = indStructureRef.current.get(cfg.id) !== structureSignature;
      if (!series || structureChanged) {
        incrementChartPerformanceCounter("series.indicator.created", result.series.length);
        series?.forEach((s) => chart.removeSeries(s));
        series = result.series.map((s, seriesIndex) => {
          const cacheKey = `${cfg.id}:${seriesIndex}`;
          const presentationOptions = {
            ...indicatorSeriesPriceFormatOptions(s),
            ...indicatorSeriesAutoscaleOptions(s, () => indVolumeCeilingRef.current.get(cacheKey)),
          };
          if (s.type === "baselineFill") {
            return chart.addSeries(
              BaselineSeries,
              {
                baseValue: { type: "price", price: s.baseValue ?? 0 },
                topFillColor1: s.color,
                topFillColor2: s.color,
                topLineColor: "rgba(0, 0, 0, 0)",
                bottomFillColor1: s.fillBelowBase ? s.color : "rgba(0, 0, 0, 0)",
                bottomFillColor2: s.fillBelowBase ? s.color : "rgba(0, 0, 0, 0)",
                bottomLineColor: "rgba(0, 0, 0, 0)",
                lineVisible: s.lineVisible ?? false,
                priceLineVisible: false,
                lastValueVisible: s.lastValueVisible ?? cfg.separatePane,
                ...presentationOptions,
              },
              paneIndex,
            );
          }

          return s.type === "histogram"
            ? chart.addSeries(
                HistogramSeries,
                {
                  color: s.color,
                  priceLineVisible: false,
                  lastValueVisible: s.lastValueVisible ?? cfg.separatePane,
                  ...presentationOptions,
                },
                paneIndex,
              )
            : chart.addSeries(
                LineSeries,
                {
                  color: s.color,
                  lineWidth: s.lineWidth ?? 2,
                  lineStyle: s.lineStyle ?? 0,
                  priceLineVisible: false,
                  lastValueVisible: s.lastValueVisible ?? cfg.separatePane,
                  crosshairMarkerVisible: cfg.separatePane,
                  ...presentationOptions,
                },
                paneIndex,
              );
        });
        store.set(cfg.id, series);
        indStructureRef.current.set(cfg.id, structureSignature);
        for (const key of [...indStyleRef.current.keys()]) {
          if (key.startsWith(`${cfg.id}:`)) indStyleRef.current.delete(key);
        }
        for (const key of [...indDataRef.current.keys()]) {
          if (key.startsWith(`${cfg.id}:`)) indDataRef.current.delete(key);
        }
        for (const key of [...indVolumeCeilingRef.current.keys()]) {
          if (key.startsWith(`${cfg.id}:`)) indVolumeCeilingRef.current.delete(key);
        }
      }
      result.series.forEach((s, idx) => {
        const cacheKey = `${cfg.id}:${idx}`;
        const styleSignature = indicatorStyleSignature(s);
        if (!structureChanged && indStyleRef.current.get(cacheKey) !== styleSignature) {
          incrementChartPerformanceCounter("series.indicator.applyOptions.calls");
          const presentationOptions = {
            ...indicatorSeriesPriceFormatOptions(s),
            ...indicatorSeriesAutoscaleOptions(s, () => indVolumeCeilingRef.current.get(cacheKey)),
          };
          if (s.type === "baselineFill") {
            series![idx].applyOptions({
              baseValue: { type: "price", price: s.baseValue ?? 0 },
              topFillColor1: s.color,
              topFillColor2: s.color,
              bottomFillColor1: s.fillBelowBase ? s.color : "rgba(0, 0, 0, 0)",
              bottomFillColor2: s.fillBelowBase ? s.color : "rgba(0, 0, 0, 0)",
              lineVisible: s.lineVisible ?? false,
              lastValueVisible: s.lastValueVisible ?? cfg.separatePane,
              ...presentationOptions,
            });
          } else {
            series![idx].applyOptions({
              color: s.color,
              ...(s.type === "histogram"
                ? {
                    lastValueVisible: s.lastValueVisible ?? cfg.separatePane,
                    ...presentationOptions,
                  }
                : {
                    lineWidth: s.lineWidth ?? 2,
                    lineStyle: s.lineStyle ?? 0,
                    lastValueVisible: s.lastValueVisible ?? cfg.separatePane,
                    ...presentationOptions,
                  }),
            });
          }
        } else if (!structureChanged) {
          incrementChartPerformanceCounter("series.indicator.applyOptions.skipped");
        }
        indStyleRef.current.set(cacheKey, styleSignature);
        const projected = measureChartPerformance(
          "indicator.projection",
          () => {
            const source = indicatorSeriesDataThroughCutoff(
              indicatorSeriesDataForCandles(s, candles, visibleLogicalRangeRef.current),
              indicatorRuntimeContext.replayCutoff,
              s.type !== "histogram",
            );
            const windowed =
              s.extendToVisibleRange || !optimizationDecision.derivedData
                ? source
                : indicatorPointsInViewport(source, candles, indicatorViewport);
            incrementChartPerformanceCounter(
              "indicator.viewport.pointsAvoided",
              Math.max(0, source.length - windowed.length),
            );
            return windowed.map((p) => ({
              time: p.time as UTCTimestamp,
              value: p.value,
              ...(p.color ? { color: p.color } : {}),
            }));
          },
          { candles: candles.length, indicator: cfg.type },
        );
        const previous = indDataRef.current.get(cacheKey) ?? [];
        const plan = resolveIndicatorSeriesWritePlan(previous, projected);
        const initializePaneAutoScale = cfg.separatePane &&
          shouldInitializeIndicatorPaneAutoScale(previous, projected);
        const ceiling = s.type === "histogram" && s.valueFormat === "volume"
          ? volumeScaleCeiling(projected)
          : undefined;
        if (ceiling == null) indVolumeCeilingRef.current.delete(cacheKey);
        else indVolumeCeilingRef.current.set(cacheKey, ceiling);
        // Autoscale providers read the same projected snapshot synchronously
        // when Lightweight Charts processes the following series write.
        indDataRef.current.set(cacheKey, projected);
        if (plan === "replace") {
          measureChartSeriesWrite("indicator", "setData", projected.length, () => series![idx].setData(projected));
        } else if (plan === "append" || plan === "update-latest") {
          const latest = projected.at(-1);
          if (latest) {
            measureChartSeriesWrite("indicator", "update", 1, () => series![idx].update(latest));
          }
        } else {
          incrementChartPerformanceCounter("series.indicator.skipped");
        }
        if (initializePaneAutoScale) {
          chart.priceScale("right", paneIndex).setAutoScale(true);
        }
      });
    }
  }, [
    candles,
    indicatorViewport,
    chartIndicatorResults,
    indicatorRuntimeContext.replayCutoff,
    optimizationDecision.derivedData,
    paneIndicators,
    ready,
    theme,
  ]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || !ready) {
      setIndicatorLabels([]);
      setIndicatorDashboards([]);
      return;
    }

    const frame = requestAnimationFrame(() => {
      const width = container.clientWidth;
      const labels = overlayResults
        .flatMap(({ result }) => result.labels ?? [])
        .filter((label) =>
          label.time == null ||
          indicatorRuntimeContext.replayCutoff == null ||
          label.time <= indicatorRuntimeContext.replayCutoff,
        );
      const dashboards = overlayResults.flatMap(({ result }) => (result.dashboard ? [result.dashboard] : []));
      const rightReserve = dashboards.length > 0 ? 238 : 96;
      setIndicatorLabels(
        labels.flatMap((label) => {
          const y = series.priceToCoordinate(label.price);
          if (y == null) return [];
          const x = label.time == null ? width - 220 : chart.timeScale().timeToCoordinate(label.time as UTCTimestamp);
          if (x == null) return [];
          const leftClip = -80;
          const rightClip = width + 80;
          if (x < leftClip || x > rightClip) return [];
          return [
            {
              key: label.key,
              text: label.text,
              color: label.color,
              backgroundColor: label.backgroundColor,
              style: label.style,
              tooltip: label.tooltip,
              x: Math.min(width - rightReserve, Math.max(4, x + 8)),
              y,
            },
          ];
        }),
      );
      setIndicatorDashboards(dashboards);
    });

    return () => cancelAnimationFrame(frame);
  }, [indicatorRuntimeContext.replayCutoff, overlayResults, ready, version]);

  const toggleIndicatorVisibility = (indicator: IndicatorConfig) => {
    updateIndicator({
      id: indicator.id,
      patch: { visible: indicator.visible === false },
    });
  };

  const openIndicatorSettings = (indicator: IndicatorConfig) => {
    setEditingIndicator(indicator.id);
  };

  const openIndicatorSource = (indicator: IndicatorConfig) => {
    if (!indicator.sourceCode) return;
    if (indicator.scriptId) {
      loadPineScript(indicator.scriptId);
    } else {
      setPineEditorScriptId(null);
      setPineEditorTitle(indicator.name ?? "Custom script");
      setPineEditorSource(indicator.sourceCode);
    }
    setBottomTab("pine");
  };

  // ---- Current price marker (symbol + price + countdown) ----
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || !ready) return;
    const renderedReplayCandle = replayActive ? renderedLatestCandleRef.current : null;
    const price = renderedReplayCandle?.close ?? lastQuote?.last ?? candles[candles.length - 1]?.close;
    if (price == null) {
      setPriceMarker(null);
      return;
    }

    const coordinate = series.priceToCoordinate(price);
    if (coordinate == null) {
      setPriceMarker(null);
      return;
    }
    const last = renderedReplayCandle ?? candles[candles.length - 1];
    const previousPrice = prevMarkerPriceRef.current;
    let up = markerUpRef.current;
    if (previousPrice == null) {
      up = last ? price >= last.open : true;
    } else if (price > previousPrice) {
      up = true;
    } else if (price < previousPrice) {
      up = false;
    }
    prevMarkerPriceRef.current = price;
    markerUpRef.current = up;
    const colors = chartColors(theme);
    const markerColor = up ? colors.bull : colors.bear;
    series.applyOptions({ priceLineColor: markerColor });
    const priceScaleWidth = chart.priceScale("right").width();
    if (!Number.isFinite(priceScaleWidth) || priceScaleWidth <= 0) {
      setPriceMarker(null);
      return;
    }
    // The price row is centered on the series coordinate; reserve extra room
    // below it for the TradingView-style candle-close countdown row.
    const minY = 10;
    const mainPaneHeight = chart.panes()[0]?.getHeight() ?? container.clientHeight;
    const maxY = Math.max(minY, mainPaneHeight - 25);
    setPriceMarker({
      y: Math.min(Math.max(coordinate, minY), maxY),
      price,
      color: markerColor,
      countdown,
      priceScaleWidth,
    });
  }, [candles, countdown, lastQuote?.last, ready, replayActive, theme, version]);

  const ctx: ChartCtx | null = useMemo(() => {
    if (!ready || !chartRef.current || !candleSeriesRef.current) return null;
    return {
      chart: chartRef.current,
      candleSeries: candleSeriesRef.current,
      candles,
      version,
      indicatorPoints: indicatorMagnetPoints,
    };
  }, [indicatorMagnetPoints, ready, candles, version]);

  // ---- Right-click context menu with exact price detection ----
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const onContextMenu = (e: React.MouseEvent) => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container) return;
    e.preventDefault(); // suppress the browser default menu

    const rect = container.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    // Price detection straight from the chart API — not a mouse-coord guess.
    const price = series.coordinateToPrice(localY);
    const t = chart.timeScale().coordinateToTime(localX);
    const fallbackPrice = candles[candles.length - 1]?.close ?? 0;
    const fallbackTime = candles[candles.length - 1]?.time ?? Math.floor(Date.now() / 1000);

    setMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      price: price == null ? fallbackPrice : (price as number),
      time: t == null ? fallbackTime : (t as number),
    });
  };

  return (
    <div
      data-testid="price-chart-root"
      className="relative h-full min-w-0 w-full overflow-hidden"
      onContextMenu={interactive ? onContextMenu : undefined}
    >
      <div ref={containerRef} className="h-full w-full" />
      {ctx && <ChartContextObj.Provider value={ctx}>{children}</ChartContextObj.Provider>}
      <IndicatorOverlay labels={indicatorLabels} dashboards={indicatorDashboards} />
      <IndicatorLegend
        className="absolute left-2 top-8 z-30 max-w-[calc(100%-116px)]"
        indicators={overlayLegendIndicators}
        onToggleVisibility={toggleIndicatorVisibility}
        onSettings={openIndicatorSettings}
        onSource={openIndicatorSource}
        onRemove={(id) => removeIndicator(id)}
        valueTextById={overlayLegendValueText}
      />
      {paneIndicators.map((indicator, index) => {
        const paneElement = chartRef.current?.panes()[index + 1]?.getHTMLElement();
        const chartElement = containerRef.current;
        if (!paneElement || !chartElement) return null;
        const paneRect = paneElement.getBoundingClientRect();
        const chartRect = chartElement.getBoundingClientRect();
        return (
          <div
            key={indicator.id}
            className="absolute left-1 z-30 max-w-[calc(100%-96px)]"
            style={{ top: Math.max(0, paneRect.top - chartRect.top + 4) }}
          >
            <IndicatorLegend
              indicators={[indicator]}
              onToggleVisibility={toggleIndicatorVisibility}
              onSettings={openIndicatorSettings}
              onSource={openIndicatorSource}
              onRemove={(id) => removeIndicator(id)}
              valueTextById={paneLegendValueText}
            />
          </div>
        );
      })}
      {priceMarker && <CurrentPriceMarker marker={priceMarker} precision={precision} symbol={symbol} />}
      {interactive && menu && <ChartContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

type CurrentPriceMarkerState = {
  y: number;
  price: number;
  color: string;
  countdown: string | null;
  priceScaleWidth: number;
};

function IndicatorOverlay({
  labels,
  dashboards,
}: {
  labels: ProjectedIndicatorLabel[];
  dashboards: IndicatorDashboard[];
}) {
  return (
    <>
      {labels.map((label) => (
        <div
          key={label.key}
          className={`${label.tooltip ? "pointer-events-auto" : "pointer-events-none"} absolute z-20 whitespace-pre-wrap font-mono text-[12px] font-semibold leading-none`}
          title={label.tooltip || undefined}
          aria-label={label.tooltip || undefined}
          style={{
            color: label.color,
            backgroundColor: labelBackground(label.backgroundColor),
            border: labelBackgroundIsTransparent(label.backgroundColor)
              ? "none"
              : "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 2,
            left: label.x,
            padding: "2px 4px",
            top: label.y,
            transform: "translateY(-50%)",
            textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
            // Keep the metadata available for future style-specific layout
            // while preserving the current compact overlay presentation.
            // `label_up` sits below its anchor with an upward pointer;
            // `label_down` sits above its anchor with a downward pointer.
            ...(label.style === "label.style_label_up" ? { transform: "translateY(0%)" } : {}),
            ...(label.style === "label.style_label_down" ? { transform: "translateY(-100%)" } : {}),
          }}
        >
          {label.text}
        </div>
      ))}
      {dashboards.map((dashboard, index) => (
        <div
          key={dashboard.key}
          className="pointer-events-none absolute z-20 w-[150px] overflow-hidden rounded-lg border border-terminal-border-strong bg-terminal-raised/85 font-mono leading-[15px] text-ink shadow-floating backdrop-blur"
          style={{
            ...(dashboard.position === "Bottom Left"
              ? { bottom: 12 + index * 136, left: 12 }
              : dashboard.position === "Bottom Right"
                ? { bottom: 12 + index * 136, right: 64 }
                : { right: 64, top: 12 + index * 136 }),
            fontSize:
              dashboard.textSize === "Tiny"
                ? 9
                : dashboard.textSize === "Normal"
                  ? 12
                  : 10,
          }}
        >
          <div className="grid grid-cols-[1fr_auto] border-b border-gray-500/60">
            <div className="truncate px-1 text-cyan-300">{dashboard.title}</div>
            <div className="px-1 text-right text-gray-400">{dashboard.subtitle}</div>
          </div>
          {dashboard.rows.map((row, rowIndex) => (
            <div
              key={`${dashboard.key}:${row.label}:${rowIndex}`}
              className="grid grid-cols-[1fr_auto] border-b border-gray-500/40 last:border-b-0"
            >
              <div className="truncate px-1 text-gray-300">{row.label}</div>
              <div className="truncate px-1 text-right font-semibold" style={{ color: row.valueColor ?? "#ffffff" }}>
                {row.value}
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function CurrentPriceMarker({
  marker,
  precision,
  symbol,
}: {
  marker: CurrentPriceMarkerState;
  precision: number;
  symbol: string;
}) {
  const formattedPrice = fmtPrice(marker.price, precision);
  const accessibleLabel = marker.countdown
    ? `${symbol} current price ${formattedPrice}. Next bar in ${marker.countdown}.`
    : `${symbol} current price ${formattedPrice}.`;

  return (
    <div
      data-testid="current-price-marker"
      data-price-scale-width={marker.priceScaleWidth}
      data-symbol={symbol}
      role="group"
      aria-label={accessibleLabel}
      className="pointer-events-none absolute right-0 z-30 flex flex-col overflow-visible rounded-l-[3px] border-l border-white/30 font-mono font-semibold leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
      style={{
        top: marker.y,
        transform: "translateY(-9.5px)",
        width: marker.priceScaleWidth,
      }}
      title={marker.countdown
        ? `${symbol} · ${formattedPrice} · Next bar: ${marker.countdown}`
        : `${symbol} · ${formattedPrice}`}
    >
      <div
        data-testid="current-price-symbol"
        className="absolute right-full top-0 flex h-[19px] items-center whitespace-nowrap rounded-l-[3px] pl-1.5 pr-1 text-[10px]"
        style={{ backgroundColor: marker.color }}
      >
        {symbol}
        <span
          className="absolute -left-[5px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-r-[5px] border-y-transparent"
          style={{ borderRightColor: marker.color }}
        />
      </div>
      <div
        data-testid="current-price-value"
        className="flex h-[19px] items-center justify-end whitespace-nowrap px-1.5 text-[11px] tabular-nums"
        style={{ backgroundColor: marker.color }}
      >
        {formattedPrice}
      </div>
      {marker.countdown && (
        <div
          data-testid="current-price-countdown"
          data-countdown={marker.countdown}
          className={`flex h-[15px] items-center justify-end whitespace-nowrap tabular-nums ${
            marker.countdown.includes("d ") ? "px-1 text-[9px] tracking-[-0.02em]" : "px-1.5 text-[10px]"
          }`}
          style={{
            backgroundColor: marker.color,
            boxShadow: "inset 0 0 0 999px rgba(0, 0, 0, 0.2)",
          }}
        >
          {marker.countdown}
        </div>
      )}
    </div>
  );
}
