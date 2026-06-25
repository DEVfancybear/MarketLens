"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type IPriceLine,
} from "lightweight-charts";
import type { Candle } from "@/types";
import { useChartStore } from "@/store/chartStore";
import { useUIStore } from "@/store/uiStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { chartColors, makeTimeFormatter, BAR_SPACING } from "./chartTheme";
import { computeIndicator } from "@/services/indicators";
import { useCountdown } from "@/hooks/useCountdown";
import { useMarketDataStore } from "@/store/marketDataStore";
import { ChartContextObj, type ChartCtx } from "./ChartContext";
import { setMainChart } from "./chartRegistry";
import { ChartContextMenu, type ContextMenuState } from "./ChartContextMenu";

/**
 * Main candlestick + volume chart. Plots the supplied (replay-aware) candles,
 * overlays non-pane indicators, reports the crosshair, and exposes an imperative
 * ChartContext so overlay layers (drawings, SMC) can convert price/time to
 * pixel coordinates and repaint in lock-step with pan/zoom.
 */
export function PriceChart({
  candles,
  children,
  onReady,
}: {
  candles: Candle[];
  children?: React.ReactNode;
  onReady?: (chart: IChartApi) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const indSeriesRef = useRef<Map<string, ISeriesApi<"Line">[]>>(new Map());
  const fittedRef = useRef(false);
  const prevCandlesRef = useRef<Candle[]>([]);
  const prevThemeRef = useRef<string>("");

  const theme = useUIStore((s) => s.theme);
  const gridVisible = useUIStore((s) => s.gridVisible);
  const symbol = useChartStore((s) => s.symbol);
  const timeframe = useChartStore((s) => s.timeframe);
  const indicators = useChartStore((s) => s.indicators);
  const setCrosshair = useChartStore((s) => s.setCrosshair);

  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const countdown = useCountdown(timeframe);
  const lastQuote = useMarketDataStore((s) => s.quotes[symbol]);
  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  // ---- Create chart once ----
  useEffect(() => {
    if (!containerRef.current) return;
    const c = chartColors(theme);
    const gridColor = gridVisible ? c.grid : "rgba(0,0,0,0)";
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c.background },
        textColor: c.text,
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: gridColor, style: 0 },
        horzLines: { color: gridColor, style: 0 },
      },
      rightPriceScale: {
        borderColor: c.border,
        borderVisible: true,
        scaleMargins: { top: 0.1, bottom: 0.24 },
        entireTextOnly: true,
        ticksVisible: false,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: c.border,
        borderVisible: true,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: BAR_SPACING[timeframe] ?? 8,
        minBarSpacing: 1.5,
        fixLeftEdge: false,
        lockVisibleTimeRangeOnResize: true,
        ticksVisible: false,
      },
      localization: {
        // Floating crosshair time tooltip — HH:mm intraday, date for daily.
        timeFormatter: makeTimeFormatter(timeframe),
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: c.crosshair,
          width: 1,
          style: 2,
          labelBackgroundColor: c.crosshairLabelBg,
        },
        horzLine: {
          color: c.crosshair,
          width: 1,
          style: 2,
          labelBackgroundColor: c.crosshairLabelBg,
        },
      },
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
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: c.bull,
      downColor: c.bear,
      borderUpColor: c.bull,
      borderDownColor: c.bear,
      wickUpColor: c.bull,
      wickDownColor: c.bear,
      borderVisible: false,
      wickVisible: true,
      priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision },
      // Current-price line + colored axis label (red/green by last candle).
      priceLineVisible: true,
      priceLineWidth: 1,
      priceLineStyle: 0, // solid (TradingView style)
      lastValueVisible: true, // native price label on right axis
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: c.volumeBull,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart
      .priceScale("vol")
      .applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    setReady(true);
    setMainChart(chart);
    onReady?.(chart);

    const bump = () => setVersion((v) => v + 1);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bump);

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setCrosshair(null);
        return;
      }
      const data = param.seriesData.get(candleSeries) as Candle | undefined;
      setCrosshair({
        time: param.time as number,
        candle: data
          ? {
              ...data,
              volume:
                (param.seriesData.get(volumeSeries) as { value: number })
                  ?.value ?? 0,
            }
          : null,
      });
    });

    const ro = new ResizeObserver(bump);
    ro.observe(containerRef.current);

    const indStore = indSeriesRef.current;
    return () => {
      ro.disconnect();
      setMainChart(null);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      indStore.clear();
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Re-theme / grid toggle / timeframe-aware time format ----
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const c = chartColors(theme);
    const gridColor = gridVisible ? c.grid : "rgba(0,0,0,0)";
    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: c.background },
        textColor: c.text,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: {
        borderColor: c.border,
        barSpacing: BAR_SPACING[timeframe] ?? 8,
      },
      localization: { timeFormatter: makeTimeFormatter(timeframe) },
      crosshair: {
        vertLine: {
          color: c.crosshair,
          labelBackgroundColor: c.crosshairLabelBg,
        },
        horzLine: {
          color: c.crosshair,
          labelBackgroundColor: c.crosshairLabelBg,
        },
      },
    });
    candleSeriesRef.current?.applyOptions({
      upColor: c.bull,
      downColor: c.bear,
      borderUpColor: c.bull,
      borderDownColor: c.bear,
      wickUpColor: c.bull,
      wickDownColor: c.bear,
    });
  }, [theme, gridVisible, timeframe]);

  // ---- Push candle + volume data ----
  useEffect(() => {
    const cs = candleSeriesRef.current;
    const vs = volumeSeriesRef.current;
    if (!cs || !vs) return;
    // Empty series => symbol/timeframe just changed; re-fit on next load.
    if (candles.length === 0) fittedRef.current = false;
    const c = chartColors(theme);
    const volColor = (k: Candle) =>
      k.close >= k.open ? c.volumeBull : c.volumeBear;

    const prev = prevCandlesRef.current;
    const prevLast = prev[prev.length - 1];
    const last = candles[candles.length - 1];

    // Realtime fast path: a forming-bar tick (same length, same last time) or a
    // single appended bar → series.update() instead of a full setData. Smooth
    // O(1) updates (TradingView-style). Anything else (symbol/timeframe change,
    // history load, replay slice, theme change) → setData.
    const sameTheme = prevThemeRef.current === theme;
    const formingTick =
      candles.length === prev.length &&
      !!last &&
      !!prevLast &&
      last.time === prevLast.time;
    const appended =
      candles.length === prev.length + 1 &&
      !!prevLast &&
      candles[candles.length - 2]?.time === prevLast.time;

    if (sameTheme && (formingTick || appended)) {
      // On append, finalize the previously-forming (now penultimate) bar first.
      if (appended) {
        const penult = candles[candles.length - 2];
        cs.update({
          time: penult.time as UTCTimestamp,
          open: penult.open,
          high: penult.high,
          low: penult.low,
          close: penult.close,
        });
        vs.update({
          time: penult.time as UTCTimestamp,
          value: penult.volume,
          color: volColor(penult),
        });
      }
      cs.update({
        time: last!.time as UTCTimestamp,
        open: last!.open,
        high: last!.high,
        low: last!.low,
        close: last!.close,
      });
      vs.update({
        time: last!.time as UTCTimestamp,
        value: last!.volume,
        color: volColor(last!),
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
      vs.setData(
        candles.map((k) => ({
          time: k.time as UTCTimestamp,
          value: k.volume,
          color: volColor(k),
        })),
      );
    }

    prevCandlesRef.current = candles;
    prevThemeRef.current = theme;

    // Fit the time scale once on the first non-empty load; afterwards leave the
    // user's pan/zoom intact so replay reveals candles at the right edge.
    if (!fittedRef.current && candles.length > 0) {
      chartRef.current?.timeScale().fitContent();
      fittedRef.current = true;
    }
    setVersion((v) => v + 1);
  }, [candles, theme]);

  // ---- Overlay indicators (SMA/EMA/VWAP/ADR) ----
  const overlayIndicators = useMemo(
    () => indicators.filter((i) => i.visible && !i.separatePane),
    [indicators],
  );

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const store = indSeriesRef.current;
    const activeIds = new Set(overlayIndicators.map((i) => i.id));

    // Remove series for indicators no longer present.
    for (const [id, series] of store) {
      if (!activeIds.has(id)) {
        series.forEach((s) => chart.removeSeries(s));
        store.delete(id);
      }
    }

    for (const cfg of overlayIndicators) {
      const result = computeIndicator(cfg, candles);
      let series = store.get(cfg.id);
      if (!series || series.length !== result.series.length) {
        series?.forEach((s) => chart.removeSeries(s));
        series = result.series.map((s) =>
          chart.addLineSeries({
            color: s.color,
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          }),
        );
        store.set(cfg.id, series);
      }
      result.series.forEach((s, idx) => {
        series![idx].applyOptions({ color: s.color });
        series![idx].setData(
          s.data.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
        );
      });
    }
  }, [overlayIndicators, candles, ready]);

  // ---- Countdown price line (TradingView: right-axis countdown label) ----
  const countdownLineRef = useRef<IPriceLine | null>(null);
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !ready) return;
    const price = lastQuote?.last ?? candles[candles.length - 1]?.close;
    if (price == null) return;

    // Remove old line; create new one at the current quote price.
    if (countdownLineRef.current) {
      series.removePriceLine(countdownLineRef.current);
      countdownLineRef.current = null;
    }

    countdownLineRef.current = series.createPriceLine({
      price,
      color: "transparent", // invisible line — the priceLine already draws it
      lineWidth: 1,
      lineStyle: 0,
      axisLabelVisible: true,
      title: countdown, // countdown text on the right axis
    });

    return () => {
      if (countdownLineRef.current) {
        series.removePriceLine(countdownLineRef.current);
        countdownLineRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, countdown, lastQuote?.last]);

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
      {menu && <ChartContextMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
