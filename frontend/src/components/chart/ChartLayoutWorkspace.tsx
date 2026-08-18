"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getDefaultStore, useAtomValue, useSetAtom } from "jotai";
import { Loader2 } from "lucide-react";
import { workspaceReadyAtom } from "@/store/authStore";
import {
  drawingsAtom,
  drawingLayoutIdAtom,
  getCachedDrawingsForContext,
  indicatorsAtom,
  setDrawingLayoutContextAtom,
  setEditingDrawingAtom,
  setEditingIndicatorAtom,
  setSymbolAtom,
  setTimeframeAtom,
  symbolAtom,
  timeframeAtom,
  resolvedChartTimeZoneAtom,
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
import { useReplayClientProjection } from "@/store/replayClientStore";
import { getMarketDataState } from "@/store/marketDataStore";
import { marketSymbolsAtom } from "@/store/marketSymbolStore";
import { logAtom } from "@/store/uiStore";
import { getMarketDataService } from "@/services/market-data/MarketDataService";
import { getHistoricalDataService } from "@/services/market-data/HistoricalDataService";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { initialHistoryBars } from "@/services/market-data/historyPolicy";
import {
  canPublishMt5HistoryPage,
  mt5HistoryFreshnessError,
} from "@/services/market-data/mt5HistoryFreshness";
import { cn } from "@/utils/cn";
import type { Candle, IndicatorConfig } from "@/types";
import { selectIndicatorsForChart } from "./indicators/indicatorChartScope";
import { AlertLines } from "./AlertLines";
import { AlertOverlay } from "./AlertOverlay";
import { ChartArea } from "./ChartArea";
import { DrawingPreviewLayer } from "./DrawingPreviewLayer";
import { PriceChart } from "./PriceChart";
import {
  persistPaneLiveSeries,
  restorePaneLiveSeries,
  selectPaneLiveSeries,
  type ChartSeriesSnapshot,
} from "./paneSeriesRetention";

const PANE_HISTORY_RETRY_DELAYS_MS = [600, 1_800, 4_000, 10_000, 30_000] as const;
const EMPTY_INDICATORS: IndicatorConfig[] = [];

// MT5 serves history through one bridge slot. Serializing read-only pane loads
// avoids filling the backend's request queue when a saved 2x2 layout restores
// several cold symbol/timeframe pairs at once. Active-chart history keeps its
// independent, higher-priority path.
let paneHistoryQueue: Promise<void> = Promise.resolve();

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof DOMException) return error.name === "AbortError";
  return (error as { name?: string }).name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("The pane history request was aborted", "AbortError");
}

function waitForPaneHistoryRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function enqueuePaneHistory<T>(
  signal: AbortSignal,
  task: () => Promise<T>,
): Promise<T> {
  const run = async () => {
    if (signal.aborted) throw abortError();
    return task();
  };
  const result = paneHistoryQueue.then(run, run);
  paneHistoryQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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
  const setEditingDrawing = useSetAtom(setEditingDrawingAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const previousActiveSlot = useRef(activeSlot);
  const renderedSeriesByPane = useRef(new Map<string, ChartSeriesSnapshot>());
  const persistedSeriesMarkerByPane = useRef(new Map<string, string>());
  const [, refreshRetainedSeries] = useState(0);

  const slots = useMemo(() => visibleChartSlots(preset), [preset]);
  const activePane = panes.find((pane) => pane.slot === activeSlot) ?? panes[0];

  useEffect(() => {
    const switchedPane = previousActiveSlot.current !== activeSlot;
    previousActiveSlot.current = activeSlot;
    if (switchedPane && activePane?.initialized) {
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
    // pane-local editors before changing the active store projection, but keep
    // the selected drawing tool so the user's first selection is not discarded
    // when they activate the pane they intend to draw on.
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
    setDrawingContext,
    setEditingDrawing,
    setEditingIndicator,
    setSymbol,
    setTimeframe,
    symbol,
    timeframe,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let restored = false;
    const marketData = getMarketDataState();
    for (const pane of panes) {
      if (!pane.initialized || !pane.symbol) continue;
      if (marketData.getCandles(pane.symbol, pane.timeframe).length > 0) {
        continue;
      }
      const current = renderedSeriesByPane.current.get(pane.id);
      if (
        current?.source === "live" &&
        current.symbol === pane.symbol &&
        current.timeframe === pane.timeframe &&
        current.candles.length > 0
      ) {
        continue;
      }
      const cached = restorePaneLiveSeries(
        window.sessionStorage,
        drawingLayoutId,
        pane,
      );
      if (!cached) continue;
      renderedSeriesByPane.current.set(pane.id, cached);
      restored = true;
    }
    if (restored) refreshRetainedSeries((revision) => revision + 1);
  }, [drawingLayoutId, panes]);

  const rememberRenderedSeries = useCallback(
    (pane: ChartPaneState, snapshot: ChartSeriesSnapshot) => {
      // Replay bars are authoritative only for their owning session. Retaining
      // them as a live fallback would leak historical data into a pane after
      // Replay exits or changes scope.
      if (snapshot.source !== "live") return;
      renderedSeriesByPane.current.set(pane.id, snapshot);
      const last = snapshot.candles.at(-1);
      const marker = [
        snapshot.symbol,
        snapshot.timeframe,
        snapshot.candles.length,
        last?.time ?? "",
      ].join(":");
      const markerKey = `${pane.id}:${snapshot.symbol}:${snapshot.timeframe}`;
      if (
        typeof window !== "undefined" &&
        persistedSeriesMarkerByPane.current.get(markerKey) !== marker
      ) {
        persistedSeriesMarkerByPane.current.set(markerKey, marker);
        persistPaneLiveSeries(
          window.sessionStorage,
          drawingLayoutId,
          pane,
          snapshot,
        );
      }
    },
    [drawingLayoutId],
  );

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
        const activeChart = (
          <ChartArea
            slot={slot}
            chartId={pane.id}
            mobileControls={mobileControls}
            retainedLiveSeries={renderedSeriesByPane.current.get(pane.id)}
            onSeriesSnapshot={(snapshot) =>
              rememberRenderedSeries(pane, snapshot)
            }
          />
        );
        return (
          <section
            key={pane.id}
            data-chart-slot={slot}
            data-active-chart={active || undefined}
            aria-label={`Chart ${slot + 1}${active ? ", active" : ""}`}
            className={cn(
              "relative min-h-0 min-w-0 overflow-hidden bg-(--chart-bg)",
              active && preset !== "single" && "z-1 ring-1 ring-inset ring-brand",
              chartDropPreview?.slot === slot &&
                "z-2 ring-2 ring-inset ring-brand",
            )}
          >
            {preset === "single" ? (
              activeChart
            ) : (
              <>
                <ChartPreviewPane
                  active={active}
                  pane={pane}
                  drawingLayoutId={drawingLayoutId}
                  retainedSeries={renderedSeriesByPane.current.get(pane.id)}
                  onSeriesSnapshot={(snapshot) =>
                    rememberRenderedSeries(pane, snapshot)
                  }
                  onActivate={() => activatePane(pane)}
                />
                {active && (
                  <div
                    data-active-chart-surface
                    className="absolute inset-0 z-10 min-h-0 min-w-0 bg-(--chart-bg)"
                  >
                    {activeChart}
                  </div>
                )}
              </>
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
  active,
  pane,
  drawingLayoutId,
  retainedSeries,
  onSeriesSnapshot,
  onActivate,
}: {
  active: boolean;
  pane: ChartPaneState;
  drawingLayoutId: string;
  retainedSeries?: ChartSeriesSnapshot;
  onSeriesSnapshot: (snapshot: ChartSeriesSnapshot) => void;
  onActivate: () => void;
}) {
  const replay = useReplayClientProjection();
  const replayOwnsPane = Boolean(
    replay.snapshot?.tracks.some((track) => track.slot === pane.slot),
  );
  const indicatorRegistry = useAtomValue(indicatorsAtom);
  const activeDrawingRevision = useAtomValue(drawingsAtom);
  const timeZone = useAtomValue(resolvedChartTimeZoneAtom);
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
  const { candles, loading } = usePaneMarketData(
    pane,
    !replayOwnsPane,
    !active && !replayOwnsPane,
  );
  const displayedCandles = useChartSeries(
    pane.slot,
    selectPaneLiveSeries(pane, candles, retainedSeries),
  );
  const last = displayedCandles[displayedCandles.length - 1];
  const market = getMarketSymbol(pane.symbol);

  useEffect(() => {
    if (replayOwnsPane || candles.length === 0) return;
    onSeriesSnapshot({
      symbol: pane.symbol,
      timeframe: pane.timeframe,
      candles,
      source: "live",
    });
  }, [
    candles,
    onSeriesSnapshot,
    pane.symbol,
    pane.timeframe,
    replayOwnsPane,
  ]);

  return (
    <div
      data-chart-preview
      aria-hidden={active || undefined}
      className={cn(
        "relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-(--chart-bg)",
        active && "pointer-events-none",
      )}
    >
      <PriceChart
        candles={displayedCandles}
        indicatorsOverride={active ? EMPTY_INDICATORS : indicators}
        symbolOverride={pane.symbol}
        timeframeOverride={pane.timeframe}
        timeZone={timeZone}
        replayTrackSlot={pane.slot}
        interactive={false}
        registerAsMain={false}
        decorationsVisible={!active}
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
      {!active && (
        <>
          <div className="pointer-events-none absolute left-2 top-2 z-20 rounded-lg border border-terminal-border bg-terminal-panel/82 px-2 py-1.5 text-[10px] shadow-terminal backdrop-blur-sm">
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
            className="absolute inset-0 z-30 cursor-pointer bg-transparent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          >
            <span className="sr-only">Activate chart {pane.slot + 1}</span>
          </button>
        </>
      )}
    </div>
  );
}

function usePaneMarketData(
  pane: ChartPaneState,
  enabled: boolean,
  recoverHistory: boolean,
): {
  candles: Candle[];
  loading: boolean;
} {
  const candles = useCandles(pane.symbol, pane.timeframe) as Candle[];
  // The MT5 catalog is populated asynchronously. Subscribe to its size so a
  // preview that mounted during the cold-start window retries once symbols are
  // available instead of remaining blank until the pane is activated.
  const catalogSize = useAtomValue(marketSymbolsAtom).length;
  const workspaceReady = useAtomValue(workspaceReadyAtom);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const market = pane.symbol ? getMarketSymbol(pane.symbol) : undefined;
    if (
      !workspaceReady ||
      !pane.initialized ||
      !pane.symbol ||
      !market
    ) return;
    const marketData = getMarketDataState();
    getMarketDataService();
    marketData.subscribe({
      symbol: pane.symbol,
      channels: ["kline"],
      timeframe: pane.timeframe,
    });

    return () => {
      marketData.unsubscribe(pane.symbol, pane.timeframe);
    };
  }, [
    catalogSize,
    enabled,
    pane.initialized,
    pane.symbol,
    pane.timeframe,
    workspaceReady,
  ]);

  useEffect(() => {
    if (!enabled || !recoverHistory) {
      setLoading(false);
      return;
    }
    const market = pane.symbol ? getMarketSymbol(pane.symbol) : undefined;
    if (
      !workspaceReady ||
      !pane.initialized ||
      !pane.symbol ||
      !market
    ) {
      setLoading(false);
      return;
    }
    const marketData = getMarketDataState();
    const controller = new AbortController();

    if (marketData.getCandles(pane.symbol, pane.timeframe).length === 0) {
      setLoading(true);
      void (async () => {
        let retryAttempt = 0;
        let loggedFailure = false;

        while (
          !controller.signal.aborted &&
          marketData.getCandles(pane.symbol, pane.timeframe).length === 0
        ) {
          try {
            const loadHistory = async () => {
              const cached = marketData.getCandles(pane.symbol, pane.timeframe) as Candle[];
              if (cached.length > 0) return cached;
              const page = await getHistoricalDataService().loadHistoryPage(
                {
                  symbol: pane.symbol,
                  timeframe: pane.timeframe,
                  limit: initialHistoryBars(pane.timeframe),
                },
                { signal: controller.signal },
              );
              if (market.provider === "mt5" && !canPublishMt5HistoryPage(page)) {
                throw new Error(
                  mt5HistoryFreshnessError(page, pane.symbol, pane.timeframe),
                );
              }
              return page.candles;
            };
            const history =
              market.provider === "mt5"
                ? await enqueuePaneHistory(controller.signal, loadHistory)
                : await loadHistory();
            if (controller.signal.aborted) return;
            if (history.length === 0) {
              throw new Error(`No history candles returned for ${pane.symbol} ${pane.timeframe}`);
            }
            marketData.setCandles(pane.symbol, pane.timeframe, history);
            return;
          } catch (error) {
            if (controller.signal.aborted || isAbortError(error)) return;
            if (!loggedFailure) {
              loggedFailure = true;
              const message = error instanceof Error ? error.message : String(error);
              getDefaultStore().set(
                logAtom,
                "warn",
                `Pane history load failed for ${pane.symbol} ${pane.timeframe}; retrying: ${message}`,
              );
            }
            const retryDelay =
              PANE_HISTORY_RETRY_DELAYS_MS[
                Math.min(retryAttempt, PANE_HISTORY_RETRY_DELAYS_MS.length - 1)
              ];
            retryAttempt += 1;
            // Pane-specific jitter prevents several cold panes from retrying in
            // lockstep after the backend bridge reconnects.
            await waitForPaneHistoryRetry(
              retryDelay + pane.slot * 125,
              controller.signal,
            );
          }
        }
      })()
        .catch((error) => {
          if (!controller.signal.aborted && !isAbortError(error)) {
            const message = error instanceof Error ? error.message : String(error);
            getDefaultStore().set(
              logAtom,
              "warn",
              `Pane history recovery stopped for ${pane.symbol} ${pane.timeframe}: ${message}`,
            );
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    } else {
      setLoading(false);
    }

    return () => {
      controller.abort();
    };
  }, [
    catalogSize,
    enabled,
    pane.initialized,
    pane.slot,
    pane.symbol,
    pane.timeframe,
    recoverHistory,
    workspaceReady,
  ]);

  return {
    candles: workspaceReady ? candles : [],
    loading: workspaceReady && loading,
  };
}
