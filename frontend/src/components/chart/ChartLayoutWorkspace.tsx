"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Loader2 } from "lucide-react";
import {
  drawingsAtom,
  drawingLayoutIdAtom,
  getCachedDrawingsForContext,
  indicatorsAtom,
  setActiveToolAtom,
  setDrawingLayoutContextAtom,
  setEditingDrawingAtom,
  setEditingIndicatorAtom,
  setSymbolAtom,
  setTimeframeAtom,
  symbolAtom,
  timeframeAtom,
} from "@/store/chartStore";
import {
  activeChartSlotAtom,
  chartSymbolDropPreviewAtom,
  chartLayoutPresetAtom,
  chartPanesAtom,
  setActiveChartSlotAtom,
  syncActiveChartPaneAtom,
  visibleChartSlots,
  type ChartPaneState,
} from "@/store/replayLayoutStore";
import { useCandles } from "@/hooks/useCandles";
import { useChartSeries } from "@/hooks/useChartSeries";
import { getMarketDataState } from "@/store/marketDataStore";
import { marketSymbolsAtom } from "@/store/marketSymbolStore";
import { getMarketDataService } from "@/services/market-data/MarketDataService";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { initialHistoryBars } from "@/services/market-data/historyPolicy";
import { cn } from "@/utils/cn";
import type { Candle } from "@/types";
import { selectIndicatorsForChart } from "./indicators/indicatorChartScope";
import { AlertLines } from "./AlertLines";
import { AlertOverlay } from "./AlertOverlay";
import { ChartArea } from "./ChartArea";
import { DrawingPreviewLayer } from "./DrawingPreviewLayer";
import { PriceChart } from "./PriceChart";

export function ChartLayoutWorkspace({
  mobileControls,
}: {
  mobileControls?: ReactNode;
} = {}) {
  const preset = useAtomValue(chartLayoutPresetAtom);
  const panes = useAtomValue(chartPanesAtom);
  const activeSlot = useAtomValue(activeChartSlotAtom);
  const chartDropPreview = useAtomValue(chartSymbolDropPreviewAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const drawingLayoutId = useAtomValue(drawingLayoutIdAtom);
  const setActiveSlot = useSetAtom(setActiveChartSlotAtom);
  const syncActivePane = useSetAtom(syncActiveChartPaneAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const setTimeframe = useSetAtom(setTimeframeAtom);
  const setDrawingContext = useSetAtom(setDrawingLayoutContextAtom);
  const setActiveTool = useSetAtom(setActiveToolAtom);
  const setEditingDrawing = useSetAtom(setEditingDrawingAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const previousActiveSlot = useRef(activeSlot);

  const slots = useMemo(() => visibleChartSlots(preset), [preset]);
  const activePane = panes.find((pane) => pane.slot === activeSlot) ?? panes[0];

  useEffect(() => {
    const switchedPane = previousActiveSlot.current !== activeSlot;
    previousActiveSlot.current = activeSlot;
    if (switchedPane && activePane?.initialized) {
      setActiveTool("cursor");
      setEditingDrawing(null);
      setEditingIndicator(null);
      setDrawingContext({ layoutId: drawingLayoutId, chartId: activePane.id });
      if (activePane.symbol && activePane.symbol !== symbol) {
        setSymbol(activePane.symbol);
      }
      if (activePane.timeframe !== timeframe) {
        setTimeframe(activePane.timeframe);
      }
      return;
    }
    syncActivePane({ symbol, timeframe });
  }, [
    activePane?.id,
    activePane?.initialized,
    activePane?.symbol,
    activePane?.timeframe,
    activeSlot,
    drawingLayoutId,
    setActiveTool,
    setDrawingContext,
    setEditingDrawing,
    setEditingIndicator,
    setSymbol,
    setTimeframe,
    symbol,
    syncActivePane,
    timeframe,
  ]);

  const activatePane = useCallback((pane: ChartPaneState) => {
    if (pane.slot === activeSlot) return;
    // A drawing/indicator gesture belongs to the pane where it started. Close
    // transient editor/tool state before changing the active store projection.
    setActiveTool("cursor");
    setEditingDrawing(null);
    setEditingIndicator(null);
    setDrawingContext({ layoutId: drawingLayoutId, chartId: pane.id });
    setActiveSlot(pane.slot);
    if (pane.initialized && pane.symbol && pane.symbol !== symbol) {
      setSymbol(pane.symbol);
    }
    if (pane.initialized && pane.timeframe !== timeframe) {
      setTimeframe(pane.timeframe);
    }
  }, [
    activeSlot,
    drawingLayoutId,
    setActiveSlot,
    setActiveTool,
    setDrawingContext,
    setEditingDrawing,
    setEditingIndicator,
    setSymbol,
    setTimeframe,
    symbol,
    timeframe,
  ]);

  return (
    <div
      data-chart-layout={preset}
      className={cn(
        "grid h-full min-h-0 w-full min-w-0 gap-px overflow-hidden bg-terminal-border",
        preset === "single" && "grid-cols-1 grid-rows-1",
        preset === "two_horizontal" && "grid-cols-2 grid-rows-1",
        preset === "two_vertical" && "grid-cols-1 grid-rows-2",
        preset === "grid_2x2" && "grid-cols-2 grid-rows-2",
      )}
    >
      {slots.map((slot) => {
        const pane = panes.find((candidate) => candidate.slot === slot) ?? panes[0]!;
        const active = slot === activeSlot;
        return (
          <section
            key={pane.id}
            data-chart-slot={slot}
            data-active-chart={active || undefined}
            aria-label={`Chart ${slot + 1}${active ? ", active" : ""}`}
            className={cn(
              "relative min-h-0 min-w-0 overflow-hidden bg-[var(--chart-bg)]",
              active && preset !== "single" && "z-[1] ring-1 ring-inset ring-brand",
              chartDropPreview?.slot === slot &&
                "z-[2] ring-2 ring-inset ring-brand",
            )}
          >
            {active ? (
              <ChartArea
                slot={slot}
                chartId={pane.id}
                mobileControls={mobileControls}
              />
            ) : (
              <ChartPreviewPane
                pane={pane}
                drawingLayoutId={drawingLayoutId}
                onActivate={() => activatePane(pane)}
              />
            )}
            {chartDropPreview?.slot === slot && (
              <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-brand/10 backdrop-blur-[1px]">
                <div className="rounded-lg border border-brand/60 bg-terminal-raised/95 px-3 py-2 text-xs font-semibold text-ink shadow-terminal">
                  Drop {chartDropPreview.symbol} on Chart {slot + 1}
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ChartPreviewPane({
  pane,
  drawingLayoutId,
  onActivate,
}: {
  pane: ChartPaneState;
  drawingLayoutId: string;
  onActivate: () => void;
}) {
  const indicatorRegistry = useAtomValue(indicatorsAtom);
  const activeDrawingRevision = useAtomValue(drawingsAtom);
  const indicators = useMemo(
    () =>
      selectIndicatorsForChart(indicatorRegistry, {
        layoutId: drawingLayoutId,
        chartId: pane.id,
      }),
    [drawingLayoutId, indicatorRegistry, pane.id],
  );
  const drawings = useMemo(() => {
    // Active drawing mutations are persisted synchronously. Subscribing to the
    // active slice invalidates this read-only projection for sibling panes.
    void activeDrawingRevision;
    return getCachedDrawingsForContext({
      symbol: pane.symbol,
      layoutId: drawingLayoutId,
      chartId: pane.id,
    });
  }, [activeDrawingRevision, drawingLayoutId, pane.id, pane.symbol]);
  const { candles, loading } = usePaneMarketData(pane);
  const displayedCandles = useChartSeries(pane.slot, candles);
  const last = displayedCandles[displayedCandles.length - 1];
  const market = getMarketSymbol(pane.symbol);

  return (
    <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-[var(--chart-bg)]">
      <PriceChart
        candles={displayedCandles}
        indicatorsOverride={indicators}
        symbolOverride={pane.symbol}
        timeframeOverride={pane.timeframe}
        replayTrackSlot={pane.slot}
        interactive={false}
        registerAsMain={false}
      >
        <AlertLines chartId={pane.id} symbol={pane.symbol} />
        <AlertOverlay
          chartId={pane.id}
          symbol={pane.symbol}
          interactive={false}
        />
        <DrawingPreviewLayer
          drawings={drawings}
          symbol={pane.symbol}
          timeframe={pane.timeframe}
        />
      </PriceChart>
      <div className="pointer-events-none absolute left-2 top-2 z-20 rounded-lg border border-terminal-border bg-terminal-panel/82 px-2 py-1.5 text-[10px] shadow-terminal backdrop-blur">
        <div className="flex items-center gap-1 text-ink-muted">
          <strong className="text-xs text-ink">{pane.symbol || "Chart"}</strong>
          {market?.exchange && <span>· {market.exchange}</span>}
          <span>· {pane.timeframe}</span>
        </div>
        {last && (
          <div className={last.close >= last.open ? "text-bull" : "text-bear"}>
            O {last.open} H {last.high} L {last.low} C {last.close}
          </div>
        )}
      </div>
      {loading && displayedCandles.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-ink-muted">
          <Loader2 size={18} className="animate-spin" />
        </div>
      )}
      <button
        type="button"
        aria-label={`Activate chart ${pane.slot + 1}: ${pane.symbol || "empty chart"} ${pane.timeframe}`}
        onClick={onActivate}
        className="absolute inset-0 z-30 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <span className="sr-only">Activate chart {pane.slot + 1}</span>
      </button>
    </div>
  );
}

function usePaneMarketData(pane: ChartPaneState): {
  candles: Candle[];
  loading: boolean;
} {
  const candles = useCandles(pane.symbol, pane.timeframe) as Candle[];
  // The MT5 catalog is populated asynchronously. Subscribe to its size so a
  // preview that mounted during the cold-start window retries once symbols are
  // available instead of remaining blank until the pane is activated.
  const catalogSize = useAtomValue(marketSymbolsAtom).length;
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pane.initialized || !pane.symbol || !getMarketSymbol(pane.symbol)) return;
    const marketData = getMarketDataState();
    const controller = new AbortController();
    getMarketDataService();
    marketData.subscribe({
      symbol: pane.symbol,
      channels: ["kline"],
      timeframe: pane.timeframe,
    });

    if (marketData.getCandles(pane.symbol, pane.timeframe).length === 0) {
      setLoading(true);
      void getHistoricalDataService()
        .loadHistory(
          {
            symbol: pane.symbol,
            timeframe: pane.timeframe,
            limit: initialHistoryBars(pane.timeframe),
          },
          { signal: controller.signal },
        )
        .then((history) => {
          if (!controller.signal.aborted) {
            marketData.setCandles(pane.symbol, pane.timeframe, history);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }

    return () => {
      controller.abort();
      marketData.unsubscribe(pane.symbol, pane.timeframe);
    };
  }, [catalogSize, pane.initialized, pane.symbol, pane.timeframe]);

  return { candles, loading };
}
