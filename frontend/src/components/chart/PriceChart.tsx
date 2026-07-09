"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
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
  Timeframe,
} from "@/types";
import { useAtomValue, useSetAtom } from "jotai";
import {
  symbolAtom,
  timeframeAtom,
  indicatorsAtom,
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
import { activeAtom as replayActiveAtom } from "@/store/replayStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { indicatorResultValueText } from "@/services/indicatorStyle";
import { indicatorSeriesDataForCandles } from "@/services/indicatorSeriesProjection";
import { chartColors, makeTimeFormatter } from "./chartTheme";
import {
  RIGHT_OFFSET_BARS,
  candlestickOptions,
  crosshairOptions,
  gridOptions,
  layoutOptions,
  mainPriceScaleOptions,
  timeScaleDefaults,
  timeScaleOptions,
} from "./chartVisualProfile";
import { computeIndicator } from "@/services/indicators";
import {
  ensurePineIndicatorResult,
  subscribePineRuntimeCache,
} from "@/services/pineRuntimeCache";
import {
  resolveRealtimeSeriesUpdatePlan,
  type RealtimeSeriesUpdatePlan,
} from "@/services/market-data/candleSeries";
import { useCountdown } from "@/hooks/useCountdown";
import { useMarketDataStore } from "@/store/marketDataStore";
import { fmtPrice } from "@/utils/format";
import { ChartContextObj, type ChartCtx } from "./ChartContext";
import { setMainChart, setMainChartDefaultViewport } from "./chartRegistry";
import { ChartContextMenu, type ContextMenuState } from "./ChartContextMenu";
import { IndicatorLegend } from "./IndicatorLegend";
import { subscribeChartViewportEvents } from "./chartViewportEvents";
import {
  latestReplayLogicalRange,
  shouldRealignReplayViewport,
} from "./replayViewport";
import { decideAutoFitCandleWindow } from "./chartAutoFitPolicy";

function keepLatestBarInView(chart: IChartApi, dataLength: number) {
  const timeScale = chart.timeScale();
  const next = latestReplayLogicalRange(
    dataLength,
    timeScale.getVisibleLogicalRange(),
    RIGHT_OFFSET_BARS,
  );
  if (next) timeScale.setVisibleLogicalRange(next);
}

const LEFT_HISTORY_PREFETCH_BARS = 120;

type IndicatorSeriesApi =
  | ISeriesApi<"Line">
  | ISeriesApi<"Histogram">
  | ISeriesApi<"Baseline">;
type ProjectedIndicatorLabel = {
  key: string;
  text: string;
  color: string;
  backgroundColor?: string;
  x: number;
  y: number;
};

function seriesPriceFormatOptions(series: IndicatorSeries) {
  if (series.precision == null) return {};
  return {
    priceFormat: {
      type: "price" as const,
      precision: series.precision,
      minMove: 1 / 10 ** series.precision,
    },
  };
}

function labelBackground(color: string | undefined): string {
  if (!color) return "rgba(8, 12, 18, 0.72)";
  const transparentRgba = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/i);
  if (transparentRgba && Number(transparentRgba[1]) < 0.08) {
    return "rgba(8, 12, 18, 0.72)";
  }
  return color;
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
  const nextIndexOfPreviousFirst = next.findIndex(
    (candle) => candle.time === previousFirstTime,
  );
  if (nextIndexOfPreviousFirst <= 0) return range;
  return {
    from: (Number(range.from) + nextIndexOfPreviousFirst) as Logical,
    to: (Number(range.to) + nextIndexOfPreviousFirst) as Logical,
  };
}

/**
 * Main candlestick chart. Plots the supplied (replay-aware) candles, overlays
 * non-pane indicators, reports the crosshair, and exposes an imperative
 * ChartContext so overlay layers (drawings, SMC) can convert price/time to
 * pixel coordinates and repaint in lock-step with pan/zoom.
 */
export function PriceChart({
  candles,
  children,
  onLoadMoreHistory,
  onReady,
}: {
  candles: Candle[];
  children?: React.ReactNode;
  onLoadMoreHistory?: () => Promise<void> | void;
  onReady?: (chart: IChartApi) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const indSeriesRef = useRef<Map<string, IndicatorSeriesApi[]>>(new Map());
  const fittedRef = useRef(false);
  const lastAutoFitLengthRef = useRef(0);
  const prevCandlesRef = useRef<Candle[]>([]);
  const candleByTimeRef = useRef<Map<number, Candle>>(new Map());
  const prevThemeRef = useRef<string>("");
  const appliedTimeframeRef = useRef<Timeframe | null>(null);
  const bumpRafRef = useRef<number | null>(null);
  const prevMarkerPriceRef = useRef<number | null>(null);
  const markerUpRef = useRef(true);
  const candlesRef = useRef<Candle[]>(candles);
  const loadMoreHistoryRef = useRef(onLoadMoreHistory);
  const loadMoreInFlightRef = useRef(false);
  const lastLoadMoreFirstTimeRef = useRef<number | null>(null);

  const theme = useAtomValue(themeAtom);
  const gridVisible = useAtomValue(gridVisibleAtom);
  const replayActive = useAtomValue(replayActiveAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const indicators = useAtomValue(indicatorsAtom);
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
  const [priceMarker, setPriceMarker] =
    useState<CurrentPriceMarkerState | null>(null);
  const [indicatorLabels, setIndicatorLabels] = useState<
    ProjectedIndicatorLabel[]
  >([]);
  const [indicatorDashboards, setIndicatorDashboards] = useState<
    IndicatorDashboard[]
  >([]);
  const [pineRuntimeVersion, setPineRuntimeVersion] = useState(0);
  const countdown = useCountdown(timeframe);
  const lastQuote = useMarketDataStore((s) => s.quotes[symbol]);
  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  const scheduleVersionBump = useCallback(() => {
    if (bumpRafRef.current !== null) return;
    bumpRafRef.current = requestAnimationFrame(() => {
      bumpRafRef.current = null;
      setVersion((v) => v + 1);
    });
  }, []);

  useEffect(() => {
    prevMarkerPriceRef.current = null;
    markerUpRef.current = true;
    lastLoadMoreFirstTimeRef.current = null;
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
    const defaultViewport = timeScaleDefaults(timeframe);
    setMainChartDefaultViewport(defaultViewport);
    appliedTimeframeRef.current = timeframe;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: layoutOptions(theme),
      grid: gridOptions(theme, gridVisible),
      rightPriceScale: mainPriceScaleOptions(theme),
      leftPriceScale: { visible: false },
      timeScale: timeScaleOptions(theme, timeframe),
      localization: {
        // Floating crosshair time tooltip — HH:mm intraday, date for daily.
        timeFormatter: makeTimeFormatter(timeframe),
      },
      crosshair: crosshairOptions(theme),
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      kineticScroll: {
        // TradingView desktop pan stops when the mouse is released. Keep touch
        // inertia for mobile, but do not let a mouse drag coast across candles.
        mouse: false,
        touch: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries(
      candlestickOptions(theme, precision),
    );

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    setReady(true);
    setMainChart(chart);
    onReady?.(chart);

    const unsubscribeViewportEvents = subscribeChartViewportEvents(
      chart,
      scheduleVersionBump,
    );

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setCrosshair(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as Candle | undefined;
      const sourceCandle = candleByTimeRef.current.get(Number(param.time));
      setCrosshair({
        time: param.time as number,
        candle: data
          ? {
              ...(sourceCandle ?? data),
              ...data,
              volume: sourceCandle?.volume ?? 0,
            }
          : null,
      });
    });

    const ro = new ResizeObserver(scheduleVersionBump);
    ro.observe(containerRef.current);

    const indStore = indSeriesRef.current;
    return () => {
      ro.disconnect();
      unsubscribeViewportEvents();
      if (bumpRafRef.current !== null) {
        cancelAnimationFrame(bumpRafRef.current);
        bumpRafRef.current = null;
      }
      setMainChart(null);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      indStore.clear();
      setReady(false);
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
      if (!range || !first || range.from > LEFT_HISTORY_PREFETCH_BARS) return;
      if (lastLoadMoreFirstTimeRef.current === first.time) return;

      lastLoadMoreFirstTimeRef.current = first.time;
      loadMoreInFlightRef.current = true;
      Promise.resolve(loadMore())
        .catch(() => {
          lastLoadMoreFirstTimeRef.current = null;
        })
        .finally(() => {
          loadMoreInFlightRef.current = false;
        });
    };

    const timeScale = chart.timeScale();
    timeScale.subscribeVisibleLogicalRangeChange(maybeLoadOlderHistory);
    maybeLoadOlderHistory();
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(maybeLoadOlderHistory);
  }, [ready]);

  // ---- Re-theme / grid toggle / timeframe-aware time format ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = chartColors(theme);
    const timeframeChanged = appliedTimeframeRef.current !== timeframe;
    const defaultViewport = timeScaleDefaults(timeframe);
    if (timeframeChanged) {
      setMainChartDefaultViewport(defaultViewport);
      appliedTimeframeRef.current = timeframe;
    }
    chart.applyOptions({
      layout: layoutOptions(theme),
      grid: gridOptions(theme, gridVisible),
      rightPriceScale: mainPriceScaleOptions(theme),
      timeScale: {
        ...(timeframeChanged
          ? timeScaleOptions(theme, timeframe)
          : { borderColor: c.border }),
        ...(timeframeChanged ? defaultViewport : {}),
        rightBarStaysOnScroll: true,
        shiftVisibleRangeOnNewBar: true,
        allowShiftVisibleRangeOnWhitespaceReplacement: false,
      },
      localization: { timeFormatter: makeTimeFormatter(timeframe) },
      crosshair: crosshairOptions(theme),
    });
    candleSeriesRef.current?.applyOptions(candlestickOptions(theme, precision));
  }, [theme, gridVisible, timeframe, precision]);

  // ---- Push candle data ----
  useEffect(() => {
    const cs = candleSeriesRef.current;
    if (!cs) return;
    // Empty series => symbol/timeframe just changed; re-fit on next load.
    if (candles.length === 0) {
      fittedRef.current = false;
      lastAutoFitLengthRef.current = 0;
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
    const structuralDataWindowChange =
      sameTheme &&
      prev.length > 0 &&
      candles.length > 0 &&
      updatePlan === "replace";
    const visibleRangeBeforeReplace =
      structuralDataWindowChange && fittedRef.current
        ? chartRef.current?.timeScale().getVisibleLogicalRange()
        : null;
    candleByTimeRef.current = updateCandleLookup(
      candleByTimeRef.current,
      candles,
      updatePlan,
    );

    if (updatePlan === "update-latest" || updatePlan === "append") {
      // On append, finalize the previously-forming (now penultimate) bar first.
      if (updatePlan === "append") {
        const penult = candles[candles.length - 2];
        cs.update({
          time: penult.time as UTCTimestamp,
          open: penult.open,
          high: penult.high,
          low: penult.low,
          close: penult.close,
        });
      }
      cs.update({
        time: last!.time as UTCTimestamp,
        open: last!.open,
        high: last!.high,
        low: last!.low,
        close: last!.close,
      });
    } else {
      cs.setData(
        candles.map((k) => ({
          time: k.time as UTCTimestamp,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        })),
      );
      const restoredRange = logicalRangeAfterDataReplacement(
        visibleRangeBeforeReplace ?? null,
        prev,
        candles,
      );
      if (restoredRange) {
        requestAnimationFrame(() => {
          chartRef.current?.timeScale().setVisibleLogicalRange(restoredRange);
        });
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
      replayActive,
    });

    if (autoFit.fitContent) {
      chartRef.current?.timeScale().fitContent();
      lastAutoFitLengthRef.current = candles.length;
      fittedRef.current = autoFit.markComplete;
    } else if (
      replayActive &&
      shouldRealignReplayViewport(
        chartRef.current?.timeScale().getVisibleLogicalRange(),
        candles.length,
      )
    ) {
      const dataLength = candles.length;
      requestAnimationFrame(() => {
        const chart = chartRef.current;
        if (!chart) return;
        if (
          replayActive &&
          shouldRealignReplayViewport(
            chart.timeScale().getVisibleLogicalRange(),
            dataLength,
          )
        ) {
          keepLatestBarInView(chart, dataLength);
        }
      });
    }
    scheduleVersionBump();
  }, [candles, theme, replayActive, scheduleVersionBump]);

  // ---- Overlay indicators (SMA/EMA/VWAP/ADR) ----
  const overlayIndicators = useMemo(
    () => indicators.filter((i) => i.visible !== false && !i.separatePane),
    [indicators],
  );
  const overlayLegendIndicators = useMemo(
    () => indicators.filter((i) => !i.separatePane),
    [indicators],
  );
  useEffect(
    () => subscribePineRuntimeCache(() => setPineRuntimeVersion((value) => value + 1)),
    [],
  );
  useEffect(() => {
    overlayIndicators.forEach((cfg) => {
      if (cfg.type === "CUSTOM") {
        ensurePineIndicatorResult(cfg, candles, { symbol, timeframe });
      }
    });
  }, [overlayIndicators, candles, symbol, timeframe]);
  const overlayResults = useMemo(
    () =>
      overlayIndicators.map((cfg) => ({
        cfg,
        result: computeIndicator(cfg, candles, { symbol, timeframe }),
      })),
    [overlayIndicators, candles, pineRuntimeVersion, symbol, timeframe],
  );
  const overlayLegendValueText = useMemo(
    () =>
      Object.fromEntries(
        overlayResults.map(({ cfg, result }) => [
          cfg.id,
          indicatorResultValueText(result),
        ]),
      ),
    [overlayResults],
  );

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const store = indSeriesRef.current;
    const activeIds = new Set(overlayResults.map((item) => item.cfg.id));

    // Remove series for indicators no longer present.
    for (const [id, series] of store) {
      if (!activeIds.has(id)) {
        series.forEach((s) => chart.removeSeries(s));
        store.delete(id);
      }
    }

    for (const { cfg, result } of overlayResults) {
      let series = store.get(cfg.id);
      if (!series || series.length !== result.series.length) {
        series?.forEach((s) => chart.removeSeries(s));
        series = result.series.map((s) => {
          if (s.type === "baselineFill") {
            return chart.addBaselineSeries({
              baseValue: { type: "price", price: s.baseValue ?? 0 },
              topFillColor1: s.color,
              topFillColor2: s.color,
              topLineColor: "rgba(0, 0, 0, 0)",
              bottomFillColor1: "rgba(0, 0, 0, 0)",
              bottomFillColor2: "rgba(0, 0, 0, 0)",
              bottomLineColor: "rgba(0, 0, 0, 0)",
              lineVisible: s.lineVisible ?? false,
              priceLineVisible: false,
              lastValueVisible: s.lastValueVisible ?? false,
              ...seriesPriceFormatOptions(s),
            });
          }

          return s.type === "histogram"
            ? chart.addHistogramSeries({
                color: s.color,
                priceLineVisible: false,
                lastValueVisible: s.lastValueVisible ?? false,
                ...seriesPriceFormatOptions(s),
              })
            : chart.addLineSeries({
                color: s.color,
                lineWidth: s.lineWidth ?? 2,
                lineStyle: s.lineStyle ?? 0,
                priceLineVisible: false,
                lastValueVisible: s.lastValueVisible ?? false,
                crosshairMarkerVisible: false,
                ...seriesPriceFormatOptions(s),
              });
        });
        store.set(cfg.id, series);
      }
      result.series.forEach((s, idx) => {
        if (s.type === "baselineFill") {
          series![idx].applyOptions({
            baseValue: { type: "price", price: s.baseValue ?? 0 },
            topFillColor1: s.color,
            topFillColor2: s.color,
            lineVisible: s.lineVisible ?? false,
            lastValueVisible: s.lastValueVisible ?? false,
            ...seriesPriceFormatOptions(s),
          });
        } else {
          series![idx].applyOptions({
            color: s.color,
            ...(s.type === "histogram"
              ? {
                  lastValueVisible: s.lastValueVisible ?? false,
                  ...seriesPriceFormatOptions(s),
                }
              : {
                  lineWidth: s.lineWidth ?? 2,
                  lineStyle: s.lineStyle ?? 0,
                  lastValueVisible: s.lastValueVisible ?? false,
                  ...seriesPriceFormatOptions(s),
                }),
          });
        }
        series![idx].setData(
          indicatorSeriesDataForCandles(s, candles).map((p) => ({
            time: p.time as UTCTimestamp,
            value: p.value,
            ...(p.color ? { color: p.color } : {}),
          })),
        );
      });
    }
  }, [candles, overlayResults, ready, theme]);

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
      const labels = overlayResults.flatMap(({ result }) =>
        result.labels ?? [],
      );
      const dashboards = overlayResults.flatMap(({ result }) =>
        result.dashboard ? [result.dashboard] : [],
      );
      const rightReserve = dashboards.length > 0 ? 238 : 96;
      setIndicatorLabels(
        labels.flatMap((label) => {
          const y = series.priceToCoordinate(label.price);
          if (y == null) return [];
          const x =
            label.time == null
              ? width - 220
              : chart.timeScale().timeToCoordinate(label.time as UTCTimestamp);
          if (x == null) return [];
          const leftClip = -80;
          if (x < leftClip) return [];
          return [
            {
              key: label.key,
              text: label.text,
              color: label.color,
              backgroundColor: label.backgroundColor,
              x: Math.min(width - rightReserve, Math.max(4, x + 8)),
              y,
            },
          ];
        }),
      );
      setIndicatorDashboards(dashboards);
    });

    return () => cancelAnimationFrame(frame);
  }, [overlayResults, ready, version]);

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
    if (indicator.type !== "CUSTOM" || !indicator.sourceCode) return;
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
    const price = lastQuote?.last ?? candles[candles.length - 1]?.close;
    if (price == null) {
      setPriceMarker(null);
      return;
    }

    const coordinate = series.priceToCoordinate(price);
    if (coordinate == null) {
      setPriceMarker(null);
      return;
    }
    const last = candles[candles.length - 1];
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
    const minY = 12;
    const maxY = Math.max(minY, container.clientHeight - 12);
    setPriceMarker({
      y: Math.min(Math.max(coordinate, minY), maxY),
      price,
      color: markerColor,
      countdown,
    });
  }, [candles, countdown, lastQuote?.last, ready, theme, version]);

  const ctx: ChartCtx | null = useMemo(() => {
    if (!ready || !chartRef.current || !candleSeriesRef.current) return null;
    return {
      chart: chartRef.current,
      candleSeries: candleSeriesRef.current,
      candles,
      version,
    };
  }, [ready, candles, version]);

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
    const fallbackTime =
      candles[candles.length - 1]?.time ?? Math.floor(Date.now() / 1000);

    setMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      price: price == null ? fallbackPrice : (price as number),
      time: t == null ? fallbackTime : (t as number),
    });
  };

  return (
    <div className="relative h-full w-full" onContextMenu={onContextMenu}>
      <div ref={containerRef} className="h-full w-full" />
      {ctx && (
        <ChartContextObj.Provider value={ctx}>
          {children}
        </ChartContextObj.Provider>
      )}
      <IndicatorOverlay
        labels={indicatorLabels}
        dashboards={indicatorDashboards}
      />
      <IndicatorLegend
        className="absolute left-2 top-8 z-30 max-w-[calc(100%-116px)]"
        indicators={overlayLegendIndicators}
        onToggleVisibility={toggleIndicatorVisibility}
        onSettings={openIndicatorSettings}
        onSource={openIndicatorSource}
        onRemove={(id) => removeIndicator(id)}
        valueTextById={overlayLegendValueText}
      />
      {priceMarker && (
        <CurrentPriceMarker
          marker={priceMarker}
          precision={precision}
          symbol={symbol}
        />
      )}
      {menu && <ChartContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

type CurrentPriceMarkerState = {
  y: number;
  price: number;
  color: string;
  countdown: string;
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
          className="pointer-events-none absolute z-20 whitespace-nowrap font-mono text-[12px] font-semibold leading-none"
          style={{
            color: label.color,
            backgroundColor: labelBackground(label.backgroundColor),
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 2,
            left: label.x,
            padding: "2px 4px",
            top: label.y,
            transform: "translateY(-50%)",
            textShadow: "0 1px 2px rgba(0, 0, 0, 0.9)",
          }}
        >
          {label.text}
        </div>
      ))}
      {dashboards.map((dashboard, index) => (
        <div
          key={dashboard.key}
          className="pointer-events-none absolute right-16 z-20 w-[150px] overflow-hidden border border-gray-500/70 bg-black/70 font-mono text-[10px] leading-[15px] text-white shadow-xl"
          style={{ top: 12 + index * 136 }}
        >
          <div className="grid grid-cols-[1fr_auto] border-b border-gray-500/60">
            <div className="truncate px-1 text-cyan-300">{dashboard.title}</div>
            <div className="px-1 text-right text-gray-400">
              {dashboard.subtitle}
            </div>
          </div>
          {dashboard.rows.map((row, rowIndex) => (
            <div
              key={`${dashboard.key}:${row.label}:${rowIndex}`}
              className="grid grid-cols-[1fr_auto] border-b border-gray-500/40 last:border-b-0"
            >
              <div className="truncate px-1 text-gray-300">{row.label}</div>
              <div
                className="truncate px-1 text-right font-semibold"
                style={{ color: row.valueColor ?? "#ffffff" }}
              >
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
  return (
    <div
      className="pointer-events-none absolute right-0 z-30 flex -translate-y-1/2 items-center font-mono text-[11px] font-semibold leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
      style={{ top: marker.y }}
      title={`Next bar: ${marker.countdown}`}
    >
      <div
        className="relative flex h-[19px] items-center gap-1 rounded-l-[2px] px-1.5"
        style={{ backgroundColor: marker.color }}
      >
        <span>{symbol}</span>
        <span className="tabular-nums">{fmtPrice(marker.price, precision)}</span>
        <span
          className="absolute -left-[5px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-r-[5px] border-y-transparent"
          style={{ borderRightColor: marker.color }}
        />
      </div>
    </div>
  );
}
