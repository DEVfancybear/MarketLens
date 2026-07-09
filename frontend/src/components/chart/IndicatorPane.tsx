"use client";
import { useEffect, useRef, useState } from "react";
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
import { computeIndicator } from "@/services/indicators";
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

type PaneSeriesApi =
  | ISeriesApi<"Line">
  | ISeriesApi<"Histogram">
  | ISeriesApi<"Baseline">;

function seriesSignature(series: IndicatorSeries[]) {
  return series
    .map((s) =>
      [
        s.key,
        s.type ?? "line",
        s.lineWidth ?? "",
        s.lineStyle ?? "",
        s.baseValue ?? "",
        s.lineVisible ?? "",
        s.lastValueVisible ?? "",
        s.precision ?? "",
      ].join(":"),
    )
    .join("|");
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
  const candlesRef = useRef<readonly Candle[]>(candles);
  const resultRef = useRef<IndicatorResult | null>(null);
  const visibleLogicalRangeRef = useRef<IndicatorLogicalRange | null>(null);
  const projectedRangeKeyRef = useRef("");
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

  const refreshViewportProjectedSeries = (onlyExtended: boolean) => {
    const result = resultRef.current;
    const sourceCandles = candlesRef.current;
    if (!result) return;
    const visibleRange = visibleLogicalRangeRef.current;

    anchorSeriesRef.current?.setData(
      indicatorPaneTimeAnchorData(sourceCandles, result, visibleRange).map(
        (point) => ({
          time: point.time as UTCTimestamp,
          value: point.value,
        }),
      ),
    );

    result.series.forEach((s, index) => {
      if (onlyExtended && !s.extendToVisibleRange) return;
      const series = seriesRef.current[index];
      if (!series) return;
      const isHist = s.type === "histogram" || s.key === "hist";
      series.setData(
        indicatorSeriesDataForCandles(s, sourceCandles, visibleRange).map((p) => ({
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
        })),
      );
    });
  };

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

    return () => {
      chart.remove();
      chartRef.current = null;
      anchorSeriesRef.current = null;
      seriesRef.current = [];
      seriesSignatureRef.current = "";
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
    const handler = () => {
      const range = sub.getVisibleLogicalRange();
      if (range) {
        visibleLogicalRangeRef.current = { from: range.from, to: range.to };
        const rangeKey = `${Math.floor(range.from)}:${Math.ceil(range.to)}`;
        if (rangeKey !== projectedRangeKeyRef.current) {
          projectedRangeKeyRef.current = rangeKey;
          refreshViewportProjectedSeries(true);
        }
      }
      if (range && target) target.setVisibleLogicalRange(range);
    };
    sub.subscribeVisibleLogicalRangeChange(handler);
    handler();
    return () => sub.unsubscribeVisibleLogicalRangeChange(handler);
  }, [mainChart]);

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
      setLegendValueText("");
      return;
    }
    const result = computeIndicator(cfg, candles, { symbol, timeframe });
    resultRef.current = result;
    setLegendValueText(indicatorResultValueText(result));
    const signature = seriesSignature(result.series);

    if (seriesSignatureRef.current !== signature) {
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

    result.series.forEach((s, index) => {
      const series = seriesRef.current[index];
      if (!series) return;
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
    refreshViewportProjectedSeries(false);
    const range = mainChart?.timeScale().getVisibleLogicalRange();
    if (range) chart.timeScale().setVisibleLogicalRange(range);
  }, [cfg, candles, theme, pineRuntimeVersion, symbol, timeframe, mainChart]);

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
