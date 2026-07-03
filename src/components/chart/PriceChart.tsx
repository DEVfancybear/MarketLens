"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, IndicatorDashboard, IndicatorResult, Timeframe } from "@/types";
import { useAtomValue, useSetAtom } from "jotai";
import {
  symbolAtom,
  timeframeAtom,
  indicatorsAtom,
  setCrosshairAtom,
} from "@/store/chartStore";
import { themeAtom, gridVisibleAtom } from "@/store/uiStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { chartColors, makeTimeFormatter, BAR_SPACING } from "./chartTheme";
import { computeIndicator } from "@/services/indicators";
import { useCountdown } from "@/hooks/useCountdown";
import { useMarketDataStore } from "@/store/marketDataStore";
import { fmtPrice } from "@/utils/format";
import { ChartContextObj, type ChartCtx } from "./ChartContext";
import { setMainChart, setMainChartDefaultViewport } from "./chartRegistry";
import { ChartContextMenu, type ContextMenuState } from "./ChartContextMenu";

const RIGHT_OFFSET_BARS = 8;
const MIN_BAR_SPACING = 1.5;
const getDefaultBarSpacing = (timeframe: Timeframe) =>
  BAR_SPACING[timeframe] ?? 8;
type IndicatorSeriesApi =
  | ISeriesApi<"Line">
  | ISeriesApi<"Histogram">
  | ISeriesApi<"Baseline">;
type ProjectedIndicatorLabel = {
  key: string;
  text: string;
  color: string;
  x: number;
  y: number;
};

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
  const indSeriesRef = useRef<Map<string, IndicatorSeriesApi[]>>(new Map());
  const fittedRef = useRef(false);
  const prevCandlesRef = useRef<Candle[]>([]);
  const prevThemeRef = useRef<string>("");
  const bumpRafRef = useRef<number | null>(null);
  const prevMarkerPriceRef = useRef<number | null>(null);
  const markerUpRef = useRef(true);

  const theme = useAtomValue(themeAtom);
  const gridVisible = useAtomValue(gridVisibleAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const indicators = useAtomValue(indicatorsAtom);
  const setCrosshair = useSetAtom(setCrosshairAtom);

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
  const countdown = useCountdown(timeframe);
  const lastQuote = useMarketDataStore((s) => s.quotes[symbol]);
  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  useEffect(() => {
    prevMarkerPriceRef.current = null;
    markerUpRef.current = true;
  }, [symbol, timeframe]);

  // ---- Create chart once ----
  useEffect(() => {
    if (!containerRef.current) return;
    const c = chartColors(theme);
    const gridColor = gridVisible ? c.grid : "rgba(0,0,0,0)";
    setMainChartDefaultViewport({
      rightOffset: RIGHT_OFFSET_BARS,
      barSpacing: getDefaultBarSpacing(timeframe),
      minBarSpacing: MIN_BAR_SPACING,
    });
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
        rightOffset: RIGHT_OFFSET_BARS,
        barSpacing: getDefaultBarSpacing(timeframe),
        minBarSpacing: MIN_BAR_SPACING,
        fixLeftEdge: false,
        fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: true,
        shiftVisibleRangeOnNewBar: true,
        allowShiftVisibleRangeOnWhitespaceReplacement: true,
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
      kineticScroll: {
        mouse: true,
        touch: true,
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
      lastValueVisible: false, // rendered by CurrentPriceMarker below
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

    const bump = () => {
      if (bumpRafRef.current !== null) return;
      bumpRafRef.current = requestAnimationFrame(() => {
        bumpRafRef.current = null;
        setVersion((v) => v + 1);
      });
    };
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
    setMainChartDefaultViewport({
      rightOffset: RIGHT_OFFSET_BARS,
      barSpacing: getDefaultBarSpacing(timeframe),
      minBarSpacing: MIN_BAR_SPACING,
    });
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
        rightOffset: RIGHT_OFFSET_BARS,
        barSpacing: getDefaultBarSpacing(timeframe),
        minBarSpacing: MIN_BAR_SPACING,
        rightBarStaysOnScroll: true,
        shiftVisibleRangeOnNewBar: true,
        allowShiftVisibleRangeOnWhitespaceReplacement: true,
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
    if (last) {
      cs.applyOptions({
        priceLineColor: last.close >= last.open ? c.bull : c.bear,
      });
    }

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
  const overlayResults = useMemo(
    () =>
      overlayIndicators.map((cfg) => ({
        cfg,
        result: computeIndicator(cfg, candles),
      })),
    [overlayIndicators, candles],
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
            });
          }

          return s.type === "histogram"
            ? chart.addHistogramSeries({
                color: s.color,
                priceLineVisible: false,
                lastValueVisible: s.lastValueVisible ?? false,
              })
            : chart.addLineSeries({
                color: s.color,
                lineWidth: s.lineWidth ?? 2,
                lineStyle: s.lineStyle ?? 0,
                priceLineVisible: false,
                lastValueVisible: s.lastValueVisible ?? false,
                crosshairMarkerVisible: false,
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
          });
        } else {
          series![idx].applyOptions({
            color: s.color,
            ...(s.type === "histogram"
              ? { lastValueVisible: s.lastValueVisible ?? false }
              : {
                  lineWidth: s.lineWidth ?? 2,
                  lineStyle: s.lineStyle ?? 0,
                  lastValueVisible: s.lastValueVisible ?? false,
                }),
          });
        }
        series![idx].setData(
          s.data.map((p) => ({
            time: p.time as UTCTimestamp,
            value: p.value,
            ...(p.color ? { color: p.color } : {}),
          })),
        );
      });
    }
  }, [overlayResults, ready, theme]);

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
          return [
            {
              key: label.key,
              text: label.text,
              color: label.color,
              x: Math.max(4, Math.min(width - rightReserve, x + 8)),
              y,
            },
          ];
        }),
      );
      setIndicatorDashboards(dashboards);
    });

    return () => cancelAnimationFrame(frame);
  }, [overlayResults, ready, version]);

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
    const minY = 18;
    const maxY = Math.max(minY, container.clientHeight - 18);
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
            left: label.x,
            top: label.y,
            transform: "translateY(-50%)",
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
      className="pointer-events-none absolute right-0 z-20 flex -translate-y-1/2 items-start font-mono text-[11px] font-semibold leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
      style={{ top: marker.y }}
    >
      <div
        className="mt-px flex h-[18px] items-center px-1.5"
        style={{ backgroundColor: marker.color }}
      >
        {symbol}
      </div>
      <div
        className="relative flex min-w-[66px] flex-col items-center justify-center px-1.5 py-0.5"
        style={{ backgroundColor: marker.color }}
      >
        <span className="tabular-nums">{fmtPrice(marker.price, precision)}</span>
        <span className="mt-0.5 tabular-nums text-[10px] font-medium">
          {marker.countdown}
        </span>
        <span
          className="absolute -left-[5px] top-1/2 h-0 w-0 -translate-y-1/2 border-y-[5px] border-r-[5px] border-y-transparent"
          style={{ borderRightColor: marker.color }}
        />
      </div>
    </div>
  );
}
