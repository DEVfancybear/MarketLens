"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type {
  Candle,
  IndicatorConfig,
  IndicatorResult,
  IndicatorSeries,
} from "@/types";
import { useAtomValue, useSetAtom } from "jotai";
import { themeAtom } from "@/store/uiStore";
import {
  symbolAtom,
  timeframeAtom,
  loadPineScriptAtom,
  pineEditorScriptIdAtom,
  pineEditorSourceAtom,
  pineEditorTitleAtom,
  removeIndicatorAtom,
  setEditingIndicatorAtom,
  updateIndicatorAtom,
} from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import { chartColors } from "./chartTheme";
import {
  INDICATOR_PANE_HEIGHT,
  crosshairOptions,
  gridOptions,
  panePriceScaleOptions,
  transparentLayoutOptions,
} from "./chartVisualProfile";
import { computeCachedIndicator } from "@/services/indicatorComputationCache";
import { indicatorResultValueText } from "@/services/indicatorStyle";
import {
  indicatorSeriesDataForCandles,
  type IndicatorLogicalRange,
} from "@/services/indicatorSeriesProjection";
import {
  ensurePineIndicatorResult,
  subscribePineRuntimeCache,
} from "@/services/pineRuntimeCache";
import { IndicatorLegend } from "./IndicatorLegend";
import { indicatorPaneTimeAnchorData } from "./indicatorPaneTimeScale";
import {
  incrementChartPerformanceCounter,
  measureChartPerformance,
  measureChartSeriesWrite,
} from "@/services/chartPerformanceProbe";
import {
  resolveIndicatorSeriesWritePlan,
  type IndicatorWritePoint,
} from "@/services/indicatorSeriesWritePlan";
import {
  indicatorPointsInViewport,
  resolveCandleViewport,
  type CandleViewport,
} from "@/services/candleViewport";

type PaneSeriesApi =
  | ISeriesApi<"Line">
  | ISeriesApi<"Histogram">
  | ISeriesApi<"Baseline">;

function seriesStructureSignature(series: IndicatorSeries[]) {
  return series
    .map((s) => [s.key, s.type ?? "line"].join(":"))
    .join("|");
}

function seriesStyleSignature(series: IndicatorSeries[]) {
  return series.map((s) => [
    s.color,
    s.lineWidth ?? "",
    s.lineStyle ?? "",
    s.baseValue ?? "",
    s.lineVisible ?? "",
    s.lastValueVisible ?? "",
    s.precision ?? "",
  ].join(":")).join("|");
}

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

/**
 * Sub-pane chart for separate-pane indicators (RSI, MACD). Its time scale is
 * kept in sync with the main chart via the shared logical range.
 */
export function IndicatorPane({
  cfg,
  candles,
  mainChart,
}: {
  cfg: IndicatorConfig;
  candles: Candle[];
  mainChart: IChartApi | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const anchorSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const seriesRef = useRef<PaneSeriesApi[]>([]);
  const seriesSignatureRef = useRef("");
  const seriesStyleSignatureRef = useRef("");
  const anchorDataRef = useRef<IndicatorWritePoint[]>([]);
  const anchorValueRef = useRef<number | null>(null);
  const anchorContextRef = useRef("");
  const seriesDataRef = useRef<Map<number, IndicatorWritePoint[]>>(new Map());
  const candlesRef = useRef<readonly Candle[]>(candles);
  const resultRef = useRef<IndicatorResult | null>(null);
  const visibleLogicalRangeRef = useRef<IndicatorLogicalRange | null>(null);
  const projectedRangeKeyRef = useRef("");
  const viewportRef = useRef<CandleViewport | null>(null);
  const viewportRafRef = useRef<number | null>(null);
  const legendAppliedRef = useRef<string | null>(null);
  const legendPendingRef = useRef<string | null>(null);
  const legendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const theme = useAtomValue(themeAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const updateIndicator = useSetAtom(updateIndicatorAtom);
  const removeIndicator = useSetAtom(removeIndicatorAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const loadPineScript = useSetAtom(loadPineScriptAtom);
  const setPineEditorScriptId = useSetAtom(pineEditorScriptIdAtom);
  const setPineEditorTitle = useSetAtom(pineEditorTitleAtom);
  const setPineEditorSource = useSetAtom(pineEditorSourceAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const [legendValueText, setLegendValueText] = useState("");
  const [pineRuntimeVersion, setPineRuntimeVersion] = useState(0);
  const anchorContext = `${cfg.id}:${symbol}:${timeframe}`;
  if (anchorContextRef.current !== anchorContext) {
    anchorContextRef.current = anchorContext;
    anchorValueRef.current = null;
    anchorDataRef.current = [];
    viewportRef.current = null;
    projectedRangeKeyRef.current = "";
  }

  const publishLegendValue = useCallback((next: string) => {
    if (legendAppliedRef.current == null) {
      legendAppliedRef.current = next;
      setLegendValueText(next);
      return;
    }
    if (legendAppliedRef.current === next || legendPendingRef.current === next) {
      incrementChartPerformanceCounter("indicator.legend.skipped");
      return;
    }
    legendPendingRef.current = next;
    if (legendTimerRef.current) return;
    legendTimerRef.current = setTimeout(() => {
      legendTimerRef.current = null;
      const pending = legendPendingRef.current;
      legendPendingRef.current = null;
      if (pending == null || pending === legendAppliedRef.current) return;
      legendAppliedRef.current = pending;
      incrementChartPerformanceCounter("indicator.legend.updates");
      setLegendValueText(pending);
    }, 500);
  }, []);

  const refreshViewportProjectedSeries = useCallback((onlyExtended: boolean) => {
    const result = resultRef.current;
    const sourceCandles = candlesRef.current;
    if (!result) return;
    const visibleRange = visibleLogicalRangeRef.current;

    const anchorData = measureChartPerformance(
      "indicator.pane-anchor-projection",
      () => {
        const points = indicatorPaneTimeAnchorData(sourceCandles, result, visibleRange);
        const anchorValue = anchorValueRef.current ?? points[0]?.value ?? 0;
        anchorValueRef.current = anchorValue;
        return points.map((point) => ({
          time: point.time as UTCTimestamp,
          value: anchorValue,
        }));
      },
      { candles: sourceCandles.length },
    );
    const anchor = anchorSeriesRef.current;
    const anchorPlan = resolveIndicatorSeriesWritePlan(anchorDataRef.current, anchorData);
    if (anchor && anchorPlan === "replace") {
      measureChartSeriesWrite("pane-anchor", "setData", anchorData.length, () =>
        anchor.setData(anchorData),
      );
    } else if (
      anchor &&
      (anchorPlan === "append" || anchorPlan === "update-latest")
    ) {
      const latest = anchorData.at(-1);
      if (latest) {
        measureChartSeriesWrite("pane-anchor", "update", 1, () => anchor.update(latest));
      }
    } else if (anchorPlan === "none") {
      incrementChartPerformanceCounter("series.pane-anchor.skipped");
    }
    anchorDataRef.current = anchorData;

    result.series.forEach((s, index) => {
      if (onlyExtended && !s.extendToVisibleRange) return;
      const series = seriesRef.current[index];
      if (!series) return;
      const isHist = s.type === "histogram" || s.key === "hist";
      const projected = measureChartPerformance(
        "indicator.projection",
        () => {
          const source = indicatorSeriesDataForCandles(s, sourceCandles, visibleRange);
          const windowed = s.extendToVisibleRange
            ? source
            : indicatorPointsInViewport(source, sourceCandles, viewportRef.current);
          incrementChartPerformanceCounter(
            "indicator.viewport.pointsAvoided",
            Math.max(0, source.length - windowed.length),
          );
          return windowed.map((p) => ({
            time: p.time as UTCTimestamp,
            value: p.value,
            ...(p.color
              ? { color: p.color }
              : isHist
                ? {
                    color:
                      p.value >= 0
                        ? chartColors(theme).bull
                        : chartColors(theme).bear,
                  }
                : {}),
          }));
        },
        { candles: sourceCandles.length, indicator: cfg.type },
      );
      const previous = seriesDataRef.current.get(index) ?? [];
      const plan = resolveIndicatorSeriesWritePlan(previous, projected);
      if (plan === "replace") {
        measureChartSeriesWrite("indicator", "setData", projected.length, () =>
          series.setData(projected),
        );
      } else if (plan === "append" || plan === "update-latest") {
        const latest = projected.at(-1);
        if (latest) {
          measureChartSeriesWrite("indicator", "update", 1, () => series.update(latest));
        }
      } else {
        incrementChartPerformanceCounter("series.indicator.skipped");
      }
      seriesDataRef.current.set(index, projected);
    });
  }, [cfg.type, theme]);

  useEffect(() => {
    if (!containerRef.current) return;
    const c = chartColors(theme);
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: transparentLayoutOptions(theme),
      grid: gridOptions(theme, true),
      rightPriceScale: panePriceScaleOptions(theme),
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: false,
        visible: false,
      },
      crosshair: crosshairOptions(theme),
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;
    anchorSeriesRef.current = chart.addLineSeries({
      color: "rgba(0, 0, 0, 0)",
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    const seriesDataStore = seriesDataRef.current;

    return () => {
      chart.remove();
      chartRef.current = null;
      anchorSeriesRef.current = null;
      seriesRef.current = [];
      seriesSignatureRef.current = "";
      seriesStyleSignatureRef.current = "";
      anchorDataRef.current = [];
      anchorValueRef.current = null;
      seriesDataStore.clear();
      if (legendTimerRef.current) clearTimeout(legendTimerRef.current);
      legendTimerRef.current = null;
      legendPendingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = chartColors(theme);
    chart.applyOptions({
      layout: transparentLayoutOptions(theme),
      grid: gridOptions(theme, true),
      rightPriceScale: panePriceScaleOptions(theme),
      timeScale: { borderColor: c.border },
      crosshair: crosshairOptions(theme),
    });
  }, [theme]);

  // Sync time scale to the main chart.
  useEffect(() => {
    if (!mainChart) return;
    const sub = mainChart.timeScale();
    const target = chartRef.current?.timeScale();
    const applyRange = () => {
      viewportRafRef.current = null;
      const range = sub.getVisibleLogicalRange();
      if (range) {
        visibleLogicalRangeRef.current = { from: range.from, to: range.to };
        const previousViewport = viewportRef.current;
        const nextViewport = resolveCandleViewport(
          candlesRef.current.length,
          visibleLogicalRangeRef.current,
          previousViewport,
        );
        viewportRef.current = nextViewport;
        const renderWindowChanged =
          nextViewport?.revision !== previousViewport?.revision;
        incrementChartPerformanceCounter(
          renderWindowChanged
            ? "indicator.viewport.windowShifts"
            : "indicator.viewport.windowRetained",
        );
        const rangeKey = `${Math.floor(range.from)}:${Math.ceil(range.to)}`;
        if (rangeKey !== projectedRangeKeyRef.current) {
          projectedRangeKeyRef.current = rangeKey;
          refreshViewportProjectedSeries(!renderWindowChanged);
        }
      }
      if (range && target) target.setVisibleLogicalRange(range);
    };
    const handler = () => {
      incrementChartPerformanceCounter("indicator.viewport.notifications");
      if (viewportRafRef.current !== null) {
        incrementChartPerformanceCounter("indicator.viewport.coalesced");
        return;
      }
      viewportRafRef.current = requestAnimationFrame(applyRange);
    };
    sub.subscribeVisibleLogicalRangeChange(handler);
    applyRange();
    return () => {
      sub.unsubscribeVisibleLogicalRangeChange(handler);
      if (viewportRafRef.current !== null) cancelAnimationFrame(viewportRafRef.current);
      viewportRafRef.current = null;
    };
  }, [mainChart, refreshViewportProjectedSeries]);

  useEffect(
    () => subscribePineRuntimeCache(() => setPineRuntimeVersion((value) => value + 1)),
    [],
  );

  useEffect(() => {
    if (cfg.type === "CUSTOM") {
      ensurePineIndicatorResult(cfg, candles, { symbol, timeframe });
    }
  }, [cfg, candles, symbol, timeframe]);

  // Data
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    candlesRef.current = candles;
    if (cfg.visible === false) {
      for (const series of seriesRef.current) chart.removeSeries(series);
      seriesRef.current = [];
      seriesSignatureRef.current = "";
      seriesStyleSignatureRef.current = "";
      anchorDataRef.current = [];
      anchorValueRef.current = null;
      seriesDataRef.current.clear();
      legendAppliedRef.current = "";
      legendPendingRef.current = null;
      if (legendTimerRef.current) clearTimeout(legendTimerRef.current);
      legendTimerRef.current = null;
      setLegendValueText("");
      return;
    }
    void pineRuntimeVersion;
    const result = computeCachedIndicator(cfg, candles, { symbol, timeframe });
    resultRef.current = result;
    publishLegendValue(indicatorResultValueText(result));
    const currentRange = mainChart?.timeScale().getVisibleLogicalRange();
    if (currentRange) {
      visibleLogicalRangeRef.current = { from: currentRange.from, to: currentRange.to };
      viewportRef.current = resolveCandleViewport(
        candles.length,
        visibleLogicalRangeRef.current,
        viewportRef.current,
      );
    }
    const signature = seriesStructureSignature(result.series);
    const styleSignature = seriesStyleSignature(result.series);
    const structureChanged = seriesSignatureRef.current !== signature;

    if (structureChanged) {
      incrementChartPerformanceCounter("series.indicator.created", result.series.length);
      seriesRef.current.forEach((series) => {
        try {
          chart.removeSeries(series);
        } catch {
          /* series already freed with the chart */
        }
      });
      seriesRef.current = result.series.map((s) => {
        const isHist = s.type === "histogram" || s.key === "hist";
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
        return isHist
          ? chart.addHistogramSeries({
              color: s.color,
              priceLineVisible: false,
              lastValueVisible: s.lastValueVisible ?? true,
              ...seriesPriceFormatOptions(s),
            })
          : chart.addLineSeries({
              color: s.color,
              lineWidth: s.lineWidth ?? 2,
              lineStyle: s.lineStyle ?? 0,
              priceLineVisible: false,
              lastValueVisible: s.lastValueVisible ?? true,
              ...seriesPriceFormatOptions(s),
            });
      });
      seriesSignatureRef.current = signature;
      seriesStyleSignatureRef.current = styleSignature;
      seriesDataRef.current.clear();

      if (cfg.type === "RSI" && seriesRef.current[0]) {
        seriesRef.current[0].createPriceLine({
          price: 70,
          color: chartColors(theme).bear,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "",
        });
        seriesRef.current[0].createPriceLine({
          price: 30,
          color: chartColors(theme).bull,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "",
        });
      }
    }

    if (!structureChanged && seriesStyleSignatureRef.current !== styleSignature) {
      result.series.forEach((s, index) => {
        const series = seriesRef.current[index];
        if (!series) return;
        incrementChartPerformanceCounter("series.indicator.applyOptions.calls");
        const isHist = s.type === "histogram" || s.key === "hist";
        if (s.type === "baselineFill") {
          series.applyOptions({
            topFillColor1: s.color,
            topFillColor2: s.color,
            ...seriesPriceFormatOptions(s),
          });
        } else {
          series.applyOptions({
            color: s.color,
            ...(isHist
              ? {
                  lastValueVisible: s.lastValueVisible ?? true,
                  ...seriesPriceFormatOptions(s),
                }
              : {
                  lineWidth: s.lineWidth ?? 2,
                  lineStyle: s.lineStyle ?? 0,
                  lastValueVisible: s.lastValueVisible ?? true,
                  ...seriesPriceFormatOptions(s),
                }),
          });
        }
      });
      seriesStyleSignatureRef.current = styleSignature;
    } else if (!structureChanged) {
      incrementChartPerformanceCounter(
        "series.indicator.applyOptions.skipped",
        result.series.length,
      );
    }
    refreshViewportProjectedSeries(false);
    const range = mainChart?.timeScale().getVisibleLogicalRange();
    if (range) chart.timeScale().setVisibleLogicalRange(range);
  }, [
    cfg,
    candles,
    theme,
    pineRuntimeVersion,
    symbol,
    timeframe,
    mainChart,
    publishLegendValue,
    refreshViewportProjectedSeries,
  ]);

  const toggleVisibility = () => {
    updateIndicator({ id: cfg.id, patch: { visible: cfg.visible === false } });
  };

  const openSettings = () => {
    setEditingIndicator(cfg.id);
  };

  const openSource = () => {
    if (cfg.type !== "CUSTOM" || !cfg.sourceCode) return;
    if (cfg.scriptId) {
      loadPineScript(cfg.scriptId);
    } else {
      setPineEditorScriptId(null);
      setPineEditorTitle(cfg.name ?? "Custom script");
      setPineEditorSource(cfg.sourceCode);
    }
    setBottomTab("pine");
  };

  return (
    <div
      className="relative w-full border-t border-terminal-border"
      style={{ height: INDICATOR_PANE_HEIGHT }}
    >
      <IndicatorLegend
        className="absolute left-1 top-1 z-10 max-w-[calc(100%-96px)]"
        indicators={[cfg]}
        onToggleVisibility={toggleVisibility}
        onSettings={openSettings}
        onSource={openSource}
        onRemove={(id) => removeIndicator(id)}
        valueTextById={{ [cfg.id]: legendValueText }}
      />
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
