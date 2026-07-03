"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, IndicatorConfig } from "@/types";
import { useAtomValue, useSetAtom } from "jotai";
import { themeAtom } from "@/store/uiStore";
import {
  loadPineScriptAtom,
  removeIndicatorAtom,
  setEditingIndicatorAtom,
} from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import { chartColors } from "./chartTheme";
import { computeIndicator } from "@/services/indicators";
import { IconButton } from "@/components/ui/IconButton";
import { X, Settings } from "lucide-react";

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
  const theme = useAtomValue(themeAtom);
  const removeIndicator = useSetAtom(removeIndicatorAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const loadPineScript = useSetAtom(loadPineScriptAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);

  useEffect(() => {
    if (!containerRef.current) return;
    const c = chartColors(theme);
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.text,
        fontFamily: "var(--font-sans)",
        fontSize: 10,
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: false,
        visible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync time scale to the main chart.
  useEffect(() => {
    if (!mainChart) return;
    const sub = mainChart.timeScale();
    const target = chartRef.current?.timeScale();
    const handler = () => {
      const range = sub.getVisibleLogicalRange();
      if (range && target) target.setVisibleLogicalRange(range);
    };
    sub.subscribeVisibleLogicalRangeChange(handler);
    handler();
    return () => sub.unsubscribeVisibleLogicalRangeChange(handler);
  }, [mainChart, candles]);

  // Data
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // Clear previous series by removing & recreating is heavy; instead track here.
    const result = computeIndicator(cfg, candles);
    const created = result.series.map((s) => {
      const isHist = s.type === "histogram" || s.key === "hist";
      const series =
        s.type === "baselineFill"
          ? chart.addBaselineSeries({
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
            })
          : isHist
            ? chart.addHistogramSeries({
                color: s.color,
                priceLineVisible: false,
                lastValueVisible: s.lastValueVisible ?? true,
              })
            : chart.addLineSeries({
                color: s.color,
                lineWidth: s.lineWidth ?? 2,
                lineStyle: s.lineStyle ?? 0,
                priceLineVisible: false,
                lastValueVisible: s.lastValueVisible ?? true,
              });
      series.setData(
        s.data.map((p) => ({
          time: p.time as UTCTimestamp,
          value: p.value,
          ...(p.color
            ? { color: p.color }
            : isHist
            ? {
                color:
                  (p.value >= 0
                    ? chartColors(theme).bull
                    : chartColors(theme).bear),
              }
            : {}),
        })),
      );
      return series;
    });

    if (cfg.type === "RSI" && created[0]) {
      created[0].createPriceLine({
        price: 70,
        color: chartColors(theme).bear,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "",
      });
      created[0].createPriceLine({
        price: 30,
        color: chartColors(theme).bull,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "",
      });
    }

    return () => {
      // On unmount the chart-creation effect may have already disposed the chart
      // (chart.remove() also frees its series). Only remove series while the
      // chart is still alive; guard against a double-free.
      if (chartRef.current !== chart) return;
      created.forEach((s) => {
        try {
          chart.removeSeries(s);
        } catch {
          /* series already freed with the chart */
        }
      });
    };
  }, [cfg, candles, theme]);

  return (
    <div className="relative h-[120px] w-full border-t border-terminal-border">
      <div className="absolute left-2 top-1 z-10 flex items-center gap-1 text-2xs text-ink-muted">
        <span className="font-semibold">
          {cfg.type === "CUSTOM" ? (cfg.name ?? "Custom script") : cfg.type}{" "}
          {cfg.type !== "VWAP" && cfg.type !== "CUSTOM" ? cfg.length : ""}
        </span>
        <button
          onClick={() => {
            if (cfg.type === "CUSTOM" && cfg.scriptId) {
              loadPineScript(cfg.scriptId);
              setBottomTab("pine");
            } else {
              setEditingIndicator(cfg.id);
            }
          }}
          className="rounded p-0.5 text-ink-muted hover:text-ink hover:bg-terminal-hover"
          title={`${cfg.type} settings`}
        >
          <Settings size={10} />
        </button>
      </div>
      <div className="absolute right-1 top-0.5 z-10">
        <IconButton
          size="sm"
          label="Remove"
          onClick={() => removeIndicator(cfg.id)}
        >
          <X size={12} />
        </IconButton>
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
