"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { Plus } from "lucide-react";
import { useChartCtx } from "./ChartContext";
import { useAtomValue, useSetAtom, getDefaultStore } from "jotai";
import {
  candlesAtom,
  drawingsAtom,
  activeToolAtom,
  drawColorAtom,
  drawingToolPreferencesAtom,
  selectedDrawingIdAtom,
  selectedDrawingIdsAtom,
  addDrawingAtom,
  updateDrawingAtom,
  batchUpdateDrawingsAtom,
  selectDrawingAtom,
  toggleSelectDrawingAtom,
  removeDrawingAtom,
  duplicateDrawingAtom,
  setActiveToolAtom,
  setEditingDrawingAtom,
  selectAllAtom,
  symbolAtom,
  setSymbolAtom,
  timeframeAtom,
  setTimeframeAtom,
} from "@/store/chartStore";
import { TF_SECONDS, type Drawing, type Point } from "@/types";
import { getDrawingToolManifestEntry } from "@/types/drawingToolManifest";
import { resolveDrawingCreationDefaults } from "./drawing/settings/drawingToolPreferences";
import {
  effectiveMagnetMode,
  snapPointToOhlc,
  snapPointWithMagnetSources,
} from "./drawing/interaction/OhlcMagnetSnap";
import { getFrameClientRect } from "./drawing/interaction/FrameRectCache";
import { DrawingContextMenu } from "./DrawingContextMenu";
import { DrawingSettingsToolbar } from "./DrawingSettingsToolbar";
import {
  useDrawingInteractionManager,
  createRenderLoop,
} from "./drawing/engine/DrawingEngine";
import { useCommandHistory } from "./drawing/history/useCommandHistory";
import {
  CreateDrawingCommand,
  PropertyChangeCommand,
} from "./drawing/history/CommandManager";
import { TextEditor } from "./drawing/TextEditor";
import {
  TextEditSession,
  type TextEditOutcome,
} from "./drawing/interaction/TextEditSession";
import { getTool } from "./drawing/tools/ToolRegistry";
import {
  positionHitDataCoversEntry,
  resolvePositionHit,
} from "./drawing/tools/positionHitResolution";
import { subscribeChartViewportEvents } from "./chartViewportEvents";
import { setChartInteractionLocked } from "./chartInteractionLock";
import { uid } from "@/utils/id";
import { runDrawingAdapterContractAudit } from "./drawing/testing/adapterContractAudit";
import type { DrawingInteractionTestHarness } from "./drawing/testing/testHarnessTypes";
import { reconcileDrawingLifecycle } from "./drawing/lifecycle/drawingLifecycle";
import { resolveSelectionTextOverlay } from "./drawing/overlays/drawingOverlayTargets";
import { isDrawingVisibleAtTimeframe } from "./drawing/visibility/drawingIntervalVisibility";
import {
  candleIndexAtOrBefore,
  extrapolateTimeCoordinate,
  resolveCandleBarIntervalSeconds,
} from "./drawing/coordinates/drawingCoordinates";
import { mt5SymbolInfoAtom } from "@/store/mt5Store";
import { getMarketSymbol } from "@/services/market-data/symbols";
import {
  getMarketDataState,
  getRecentMarketTickCoverage,
  getRecentMarketTicks,
} from "@/store/marketDataStore";
import { loadCompleteVolumeProfileHistory } from "./drawing/data/volumeProfileHistory";
import { workspaceReadyAtom } from "@/store/authStore";
import {
  POSITION_DEFAULT_RISK_HEIGHT_PX,
  POSITION_DEFAULT_MIN_WIDTH_PX,
  positionBarCountForViewport,
  positionRiskDistanceForViewport,
  resolvePositionCreationTimeline,
  type PositionDrawingCreationOptions,
} from "./drawing/tools/positionCreation";

declare global {
  interface Window {
    __drawingInteractionTest?: DrawingInteractionTestHarness;
  }
}

export function DrawingLayer() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawings = useAtomValue(drawingsAtom);
  const activeTool = useAtomValue(activeToolAtom);
  const drawColor = useAtomValue(drawColorAtom);
  const drawingToolPreferences = useAtomValue(drawingToolPreferencesAtom);
  const storeCandles = useAtomValue(candlesAtom);
  const candles = ctx?.candles ?? storeCandles;
  const selectedDrawingId = useAtomValue(selectedDrawingIdAtom);
  const selectedDrawingIds = useAtomValue(selectedDrawingIdsAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const barIntervalSeconds = useMemo(
    () => resolveCandleBarIntervalSeconds(candles, TF_SECONDS[timeframe], 60),
    [candles, timeframe],
  );
  const mt5SymbolInfo = useAtomValue(mt5SymbolInfoAtom)[symbol];
  const marketContext = useMemo(() => {
    const catalog = getMarketSymbol(symbol);
    const tickSize = mt5SymbolInfo?.tickSize ?? mt5SymbolInfo?.point ?? catalog?.tickSize;
    const tickValue = mt5SymbolInfo?.tickValue;
    const pointValue =
      Number.isFinite(tickValue) && Number(tickValue) > 0 &&
      Number.isFinite(tickSize) && Number(tickSize) > 0
        ? Number(tickValue) / Number(tickSize)
        : 1;
    return {
      symbol,
      candles,
      tickSize,
      pricePrecision: catalog?.pricePrecision ?? 2,
      pointValue,
    };
  }, [candles, mt5SymbolInfo, symbol]);
  const visibleDrawings = useMemo(
    () => drawings.filter((drawing) => isDrawingVisibleAtTimeframe(drawing, timeframe)),
    [drawings, timeframe],
  );
  const interactionVisibleDrawingsCacheRef = useRef({
    drawings,
    timeframe,
    visibleDrawings,
  });
  interactionVisibleDrawingsCacheRef.current = {
    drawings,
    timeframe,
    visibleDrawings,
  };
  const addDrawing = useSetAtom(addDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const batchUpdateDrawings = useSetAtom(batchUpdateDrawingsAtom);
  const selectDrawing = useSetAtom(selectDrawingAtom);
  const toggleSelectDrawing = useSetAtom(toggleSelectDrawingAtom);
  const removeDrawing = useSetAtom(removeDrawingAtom);
  const duplicateDrawing = useSetAtom(duplicateDrawingAtom);
  const setActiveTool = useSetAtom(setActiveToolAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const setTimeframe = useSetAtom(setTimeframeAtom);
  const setEditingDrawing = useSetAtom(setEditingDrawingAtom);
  const selectAll = useSetAtom(selectAllAtom);

  const [textEditSession, setTextEditSession] = useState<TextEditSession | null>(null);

  const { manager: commandManager, commitMoves, undo, redo, execute } = useCommandHistory(
    addDrawing,
    removeDrawing,
    updateDrawing,
    batchUpdateDrawings,
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const toX = useCallback((time: number) => {
    const chart = ctxRef.current?.chart;
    if (!chart) return null;
    const ts = chart.timeScale();
    const rawX = ts.timeToCoordinate(time as UTCTimestamp);
    const candles = ctxRef.current?.candles ?? getDefaultStore().get(candlesAtom);
    const firstTime = candles[0]?.time;
    const lastTime = candles[candles.length - 1]?.time;
    // In-range drawing anchors may be intentionally between bars; retain the
    // chart's direct coordinate. Position creation stores its right edge on an
    // actual candle, so session gaps do not rely on the misleading gap mapping.
    if (
      rawX != null &&
      firstTime != null &&
      lastTime != null &&
      time >= firstTime &&
      time <= lastTime
    ) {
      return rawX;
    }
    if (candles.length < 2) return rawX;
    const floorIndex = candleIndexAtOrBefore(candles, time);
    const configuredInterval = resolveCandleBarIntervalSeconds(
      candles,
      TF_SECONDS[getDefaultStore().get(timeframeAtom)],
      60,
    );
    // Outside the loaded series, anchor at the nearest known candle and extend
    // using logical bar spacing rather than wall-clock candle gaps.
    let i = Math.min(
      candles.length - 1,
      Math.max(0, floorIndex ?? candles.length - 1),
    );
    let cx: number | null = null;
    for (; i >= 0; i--) {
      cx = ts.timeToCoordinate(candles[i].time as UTCTimestamp);
      if (cx != null) break;
    }
    if (cx == null) {
      for (
        i = Math.min(candles.length - 1, (floorIndex ?? 0) + 1);
        i < candles.length;
        i++
      ) {
        cx = ts.timeToCoordinate(candles[i].time as UTCTimestamp);
        if (cx != null) break;
      }
    }
    if (cx == null) return null;
    // Reference = another projected candle, used only for logical pixel width.
    let px: number | null = null;
    let j = i - 1;
    for (; j >= 0; j--) {
      px = ts.timeToCoordinate(candles[j].time as UTCTimestamp);
      if (px != null) break;
    }
    if (px == null) {
      for (j = i + 1; j < candles.length; j++) {
        px = ts.timeToCoordinate(candles[j].time as UTCTimestamp);
        if (px != null) break;
      }
    }
    if (px == null) {
      const barSpacing = ts.options().barSpacing;
      return extrapolateTimeCoordinate({
        time,
        anchorTime: candles[i].time,
        anchorX: cx,
        referenceTime: candles[i].time - configuredInterval,
        referenceX: cx - barSpacing,
        indexSpan: 1,
        barIntervalSeconds: configuredInterval,
      }) ?? cx;
    }
    // Normalize the pair so the anchor is the later logical candle.
    if (j > i) {
      [i, j] = [j, i];
      [cx, px] = [px, cx];
    }
    const span = i - j;
    const observedInterval = (candles[i].time - candles[j].time) / span || 1;
    const iv = Number.isFinite(configuredInterval) && configuredInterval > 0
      ? configuredInterval
      : observedInterval;
    return extrapolateTimeCoordinate({
      time,
      anchorTime: candles[i].time,
      anchorX: cx,
      referenceTime: candles[j].time,
      referenceX: px,
      indexSpan: span,
      barIntervalSeconds: iv,
    });
  }, []);
  const toY = useCallback(
    (price: number) =>
      ctxRef.current?.candleSeries.priceToCoordinate(price) ?? null,
    [],
  );
  // Imperatively freeze the chart's pan & zoom. Called synchronously the moment
  // a drag/draw begins (in the pointerdown handler) so the very first
  // pointermove of a *fast* drag can't leak through to the chart's
  // pressedMouseMove handler before React has a chance to run the effect below.
  const freezeChart = useCallback((busy: boolean) => {
    const chart = ctxRef.current?.chart;
    if (chart) setChartInteractionLocked(chart, "drawing-imperative", busy);
  }, []);
  const fromEvent = useCallback((e: PointerEvent): Point | null => {
    const c = ctxRef.current;
    const cv = canvasRef.current;
    if (!c || !cv) return null;
    const r = getFrameClientRect(cv);
    // The canvas, the chart container, and the time-scale pane all share the same
    // left edge and CSS-pixel width, so the local X maps 1:1 to a time-scale
    // coordinate. Do NOT rescale by timeScale().width() (which excludes the right
    // price axis) — that compresses every click's X and shifts hit-testing along
    // the line, making endpoint grabs miss and select the body instead. This
    // matches PriceChart's own coordinateToTime(localX) usage.
    const lx = e.clientX - r.left;
    const ly = e.clientY - r.top;
    const ts = c.chart.timeScale();
    let t = ts.coordinateToTime(lx) as number | null;
    const candles = ctxRef.current?.candles ?? getDefaultStore().get(candlesAtom);
    const firstTime = candles[0]?.time;
    const lastTime = candles[candles.length - 1]?.time;
    if (
      t == null ||
      (firstTime != null && lastTime != null && (t < firstTime || t > lastTime))
    ) {
      // Lightweight Charts may return either null or a wall-clock timestamp in
      // whitespace. Canonicalize both forms to timeframe-aligned logical bars
      // so time -> pixel is the exact inverse of this pointer projection.
      const logical = ts.coordinateToLogical(lx);
      if (logical != null && candles.length >= 2) {
        const lastIdx = candles.length - 1;
        const configuredInterval = resolveCandleBarIntervalSeconds(
          candles,
          TF_SECONDS[getDefaultStore().get(timeframeAtom)],
          60,
        );
        const observedInterval = candles[lastIdx].time - candles[lastIdx - 1].time;
        const interval = Number.isFinite(configuredInterval) && configuredInterval > 0
          ? configuredInterval
          : observedInterval;
        // Lightweight Charts logical indices are not guaranteed to start at
        // zero for our active candle slice. Anchor the inverse projection to a
        // candle's actual logical coordinate instead of assuming array index
        // === logical index; otherwise pre-history clicks can reproject far to
        // the left after creation.
        for (let index = lastIdx; index >= 0; index--) {
          const anchorX = ts.timeToCoordinate(candles[index].time as UTCTimestamp);
          if (anchorX == null) continue;
          const anchorLogical = ts.coordinateToLogical(anchorX);
          if (anchorLogical == null) continue;
          const barDelta = Math.round(logical - anchorLogical);
          t = candles[index].time + barDelta * interval;
          break;
        }
      }
    }
    const p = c.candleSeries.coordinateToPrice(ly);
    if (t == null || p == null) return null;
    return { time: t as number, price: p };
  }, []);
  const snapPoint = useCallback(
    (point: Point, tool: Drawing["tool"], event: PointerEvent): Point => {
      if (!getDrawingToolManifestEntry(tool).magnetEligible) return point;
      const mode = effectiveMagnetMode(
        drawingToolPreferences.magnetEnabled,
        drawingToolPreferences.magnetMode,
        event.ctrlKey || event.metaKey,
      );
      if (!mode) return point;
      return snapPointWithMagnetSources({
        point,
        candles,
        indicators: ctx?.indicatorPoints ?? [],
        mode,
        snapToIndicators: drawingToolPreferences.snapToIndicators,
        toX,
        toY,
      }).point;
    },
    [candles, ctx?.indicatorPoints, drawingToolPreferences.magnetEnabled, drawingToolPreferences.magnetMode, drawingToolPreferences.snapToIndicators, toX, toY],
  );

  const stateRef = useRef({
    drawings: [] as Drawing[],
    visibleDrawings: [] as Drawing[],
    activeTool: "cursor" as Drawing["tool"],
    drawColor: "#2962ff",
    drawingToolPreferences,
    candles,
    symbol,
    timeframe,
    barIntervalSeconds,
    marketContext,
    adapterContext: {
      tickSize: marketContext.tickSize,
      barIntervalSeconds,
      barSpacing: ctx?.chart.timeScale().options().barSpacing,
      candles: marketContext.candles,
    },
    drawingsLocked: false,
    ctxReady: false,
    drawingsHidden: false,
    selectedDrawingId: null as string | null,
    selectedDrawingIds: new Set<string>(),
  });
  stateRef.current = {
    drawings,
    visibleDrawings,
    activeTool,
    drawColor,
    drawingToolPreferences,
    candles,
    symbol,
    timeframe,
    barIntervalSeconds,
    marketContext,
    adapterContext: {
      tickSize: marketContext.tickSize,
      barIntervalSeconds,
      barSpacing: ctx?.chart.timeScale().options().barSpacing,
      candles: marketContext.candles,
    },
    drawingsLocked: false,
    ctxReady: !!ctx,
    drawingsHidden: false,
    selectedDrawingId,
    selectedDrawingIds,
  };

  useEffect(() => {
    if (selectedDrawingId && !visibleDrawings.some((drawing) => drawing.id === selectedDrawingId)) {
      selectDrawing(null);
    }
  }, [selectDrawing, selectedDrawingId, visibleDrawings]);

  const markDirtyRef = useRef<() => void>(() => {});
  const addDrawingWithHistory = useCallback(
    (d: Drawing) => {
      // `execute()` runs the command immediately (CreateDrawingCommand.execute()
      // calls addDrawing itself) and records it for undo — do NOT also call
      // addDrawing(d) directly here, or every new drawing gets inserted twice
      // under the same id (confirmed via a real repro: two identical entries
      // with an identical id in the persisted drawings array).
      let positionCreation: PositionDrawingCreationOptions | undefined;
      if (
        getDrawingToolManifestEntry(d.tool).positionSide &&
        d.points.length === 1 &&
        d.points[0]
      ) {
        const chartContext = ctxRef.current;
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const entry = d.points[0].price;
        const entryY = chartContext?.candleSeries.priceToCoordinate(entry);
        const barSpacing = chartContext?.chart.timeScale().options().barSpacing;
        const entryX = toX(d.points[0].time);
        const availableRightWidth = canvasRect && entryX != null
          ? Math.max(1, canvasRect.width - entryX - 12)
          : undefined;
        const barCount = positionBarCountForViewport(
          barSpacing,
          POSITION_DEFAULT_MIN_WIDTH_PX,
          availableRightWidth,
        );
        const creationBarIntervalSeconds = resolveCandleBarIntervalSeconds(
          chartContext?.candles ?? [],
          TF_SECONDS[getDefaultStore().get(timeframeAtom)],
          60,
        );
        const timeline = resolvePositionCreationTimeline(
          d.points[0].time,
          creationBarIntervalSeconds,
          barCount,
          chartContext?.candles ?? [],
        );
        let riskPriceDistance: number | undefined;
        if (
          chartContext &&
          canvasRect &&
          entryY != null &&
          Number.isFinite(entryY)
        ) {
          const symmetricRoom = Math.max(
            0,
            Math.min(entryY, canvasRect.height - entryY),
          );
          if (symmetricRoom > 0) {
            const riskHeightPx = Math.max(
              1,
              Math.min(POSITION_DEFAULT_RISK_HEIGHT_PX, symmetricRoom * 0.55),
            );
            riskPriceDistance = positionRiskDistanceForViewport(
              entry,
              chartContext.candleSeries.coordinateToPrice(entryY - riskHeightPx),
              chartContext.candleSeries.coordinateToPrice(entryY + riskHeightPx),
            );
          }
        }
        positionCreation = {
          barCount,
          riskPriceDistance,
          entryTime: timeline.entryTime,
          rightEdgeTime: timeline.rightEdgeTime,
        };
      }
      const addForCommand = (drawing: Drawing) => addDrawing(
        positionCreation ? { drawing, positionCreation } : drawing,
      );
      execute(new CreateDrawingCommand(addForCommand, removeDrawing, d));
    },
    [addDrawing, removeDrawing, execute, toX],
  );
  const scheduleRedraw = useCallback(() => {
    markDirtyRef.current();
  }, []);
  const textEditSessionRef = useRef(textEditSession);
  textEditSessionRef.current = textEditSession;
  const applyTextEditOutcome = useCallback(
    (outcome: TextEditOutcome) => {
      if (outcome.kind === "create") {
        removeDrawing(outcome.placeholderId);
        execute(new CreateDrawingCommand(addDrawing, removeDrawing, outcome.drawing));
      } else if (outcome.kind === "update") {
        execute(
          new PropertyChangeCommand(
            updateDrawing,
            outcome.drawingId,
            { text: outcome.newText },
            { text: outcome.oldText },
          ),
        );
      } else if (outcome.kind === "cancel-create") {
        removeDrawing(outcome.placeholderId);
      }
      setTextEditSession(null);
      scheduleRedraw();
    },
    [addDrawing, execute, removeDrawing, scheduleRedraw, updateDrawing],
  );
  const commitTextEdit = useCallback(() => {
    const session = textEditSessionRef.current;
    if (!session) return false;
    applyTextEditOutcome(session.finish(session.draftText, false));
    return true;
  }, [applyTextEditOutcome]);
  const commitTextEditRef = useRef(commitTextEdit);
  commitTextEditRef.current = commitTextEdit;
  const previousSymbolRef = useRef(symbol);
  useEffect(() => {
    if (previousSymbolRef.current !== symbol && textEditSessionRef.current) {
      applyTextEditOutcome(textEditSessionRef.current.cancel());
    }
    previousSymbolRef.current = symbol;
  }, [applyTextEditOutcome, symbol]);
  useEffect(
    () => () => {
      const session = textEditSessionRef.current;
      if (session?.editorKind === "standalone") removeDrawing(session.drawingId);
    },
    [removeDrawing],
  );

  // Handle Text tool placement: create an empty drawing and show inline editor.
  const handleTextPlace = useCallback(
    (tool: Drawing["tool"], point: Point, color: string) => {
      const canvas = canvasRef.current;
      if (!canvas || !ctx) return;
      const id = uid("dw");
      const x =
        ctx.chart.timeScale().timeToCoordinate(point.time as UTCTimestamp) ?? 0;
      const y = ctx.candleSeries.priceToCoordinate(point.price) ?? 0;
      const drawing: Drawing = {
        ...resolveDrawingCreationDefaults(
          tool,
          drawingToolPreferences.toolDefaults[tool],
          color,
        ),
        id,
        tool,
        points: [point],
        text: "",
      } as Drawing;
      addDrawing(drawing);
      setTextEditSession(TextEditSession.standalone(drawing, { x, y }));
    },
    [ctx, addDrawing, drawingToolPreferences.toolDefaults],
  );

  // The render loop is dirty-driven: it only repaints when markDirty() is called.
  // Store mutations that bypass the interaction manager — delete (keyboard/menu),
  // undo/redo, color change, lock/hide, selection change — update `drawings` but
  // would otherwise not repaint until the next pan/tick. Force a repaint whenever
  // any render-relevant store state changes so the canvas updates immediately.
  useEffect(() => {
    markDirtyRef.current();
  }, [
    drawings,
    visibleDrawings,
    selectedDrawingId,
    selectedDrawingIds,
    drawColor,
    activeTool,
    symbol,
    timeframe,
    marketContext,
  ]);

  useEffect(() => {
    const handleShapeEditorCanvasPointerDown = (event: PointerEvent) => {
      if (!textEditSessionRef.current) return;
      const target = event.target as Element | null;
      if (target?.closest?.("[data-inline-text-editor]")) return;
      if (target?.closest?.("[data-chart-ui],[data-drawing-toolbar]")) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const insideCanvas =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!insideCanvas) return;

      // TradingView treats attached text editing as an edit state of the drawing.
      // The first chart click/drag outside the input completes editing; it must
      // not also start a body drag that leaves the editor visually detached.
      if (commitTextEditRef.current()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
      }
    };
    document.addEventListener(
      "pointerdown",
      handleShapeEditorCanvasPointerDown,
      true,
    );
    return () => {
      document.removeEventListener(
        "pointerdown",
        handleShapeEditorCanvasPointerDown,
        true,
      );
    };
  }, []);

  const {
    machine,
    cursorStyle,
    ctxMenu,
    setCtxMenu,
    reset,
    machineRef,
    livePointsRef,
    drawingIdRef,
    hoveredIdRef,
  } = useDrawingInteractionManager({
    canvasRef,
    fromEvent,
    toX,
    toY,
    getState: (options) => {
      // Toolbar/Jotai writes are synchronous, while the React render that
      // refreshes stateRef may be deferred until after a fast mouse/touch tap.
      // Read creation inputs directly at the pointer boundary so the first
      // chart event after selecting a tool cannot observe the previous tool.
      const store = getDefaultStore();
      const currentTimeframe = store.get(timeframeAtom);
      const currentSymbol = store.get(symbolAtom);
      const currentDrawings = store.get(drawingsAtom);
      const visibleCache = interactionVisibleDrawingsCacheRef.current;
      const currentVisibleDrawings =
        visibleCache.drawings === currentDrawings &&
        visibleCache.timeframe === currentTimeframe
          ? visibleCache.visibleDrawings
          : currentDrawings.filter((drawing) =>
              isDrawingVisibleAtTimeframe(drawing, currentTimeframe),
            );
      if (
        visibleCache.drawings !== currentDrawings ||
        visibleCache.timeframe !== currentTimeframe
      ) {
        interactionVisibleDrawingsCacheRef.current = {
          drawings: currentDrawings,
          timeframe: currentTimeframe,
          visibleDrawings: currentVisibleDrawings,
        };
      }
      const snapshotData = options?.includeSnapshotData
        ? getMarketDataState()
        : undefined;
      return {
        ...stateRef.current,
        activeTool: store.get(activeToolAtom),
        drawColor: store.get(drawColorAtom),
        drawingToolPreferences: store.get(drawingToolPreferencesAtom),
        drawings: currentVisibleDrawings,
        visibleDrawings: currentVisibleDrawings,
        selectedDrawingId: store.get(selectedDrawingIdAtom),
        selectedDrawingIds: store.get(selectedDrawingIdsAtom),
        candles: ctxRef.current?.candles ?? store.get(candlesAtom),
        symbol: currentSymbol,
        timeframe: currentTimeframe,
        cachedCandles: snapshotData?.candles,
        recentTicks: options?.includeSnapshotData
          ? getRecentMarketTicks(currentSymbol)
          : undefined,
        recentTickCoverage: options?.includeSnapshotData
          ? getRecentMarketTickCoverage(currentSymbol)
          : undefined,
        adapterContext: {
          tickSize: stateRef.current.marketContext.tickSize,
          barIntervalSeconds: resolveCandleBarIntervalSeconds(
            ctxRef.current?.candles ?? store.get(candlesAtom),
            TF_SECONDS[currentTimeframe],
            60,
          ),
          barSpacing: ctxRef.current?.chart.timeScale().options().barSpacing,
          candles: ctxRef.current?.candles ?? store.get(candlesAtom),
        },
      };
    },
    loadVolumeProfileHistory: loadCompleteVolumeProfileHistory,
    addDrawing: addDrawingWithHistory,
    updateDrawing,
    removeDrawing,
    selectDrawing,
    toggleSelectDrawing,
    setActiveTool,
    scheduleRedraw,
    commitMoves,
    executeCommand: execute,
    undo,
    redo,
    selectAll,
    duplicateDrawing,
    openDrawingSettings: (id) => {
      const drawing = stateRef.current.drawings.find((d) => d.id === id);
      if (
        drawing &&
        getDrawingToolManifestEntry(drawing.tool).settingsOverlay === "position-dialog"
      ) {
        setEditingDrawing(id);
      }
    },
    onTextPlace: handleTextPlace,
    snapPoint,
    freezeChart,
    cancellationKey: symbol,
  });

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__drawingInteractionTest = {
      snapshot: () => {
        const rect = canvasRef.current?.getBoundingClientRect();
        const store = getDefaultStore();
        const currentDrawings = store.get(drawingsAtom);
        const currentTimeframe = store.get(timeframeAtom);
        const currentVisibleDrawings = currentDrawings.filter((drawing) =>
          isDrawingVisibleAtTimeframe(drawing, currentTimeframe),
        );
        return {
          drawings: structuredClone(currentDrawings),
          activeTool: store.get(activeToolAtom),
          selectedDrawingId: store.get(selectedDrawingIdAtom),
          selectedDrawingIds: [...store.get(selectedDrawingIdsAtom)],
          visibleDrawingIds: currentVisibleDrawings.map((drawing) => drawing.id),
          machineState: machineRef.current?.state ?? "Idle",
          history: {
            canUndo: commandManager.canUndo,
            canRedo: commandManager.canRedo,
            lastUndoLabel: commandManager.lastUndoLabel,
          },
          canvas: rect
            ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
            : { x: 0, y: 0, width: 0, height: 0 },
        };
      },
      auditAdapters: () => {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 600;
        return runDrawingAdapterContractAudit(canvas);
      },
      projectDrawing: (id) => {
        const drawing = getDefaultStore()
          .get(drawingsAtom)
          .find((item) => item.id === id);
        if (!drawing) return null;
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const projected = drawing.points.map((point) => ({
          x: toX(point.time),
          y: toY(point.price),
        }));
        if (projected.some((point) => point.x == null || point.y == null)) return null;
        return projected.map((point) => ({
          x: point.x! + rect.left,
          y: point.y! + rect.top,
        }));
      },
      inspectClientPoint: (x, y) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        if (!rect) {
          return {
            insideCanvas: false,
            overDrawingUi: false,
            target: element?.tagName ?? null,
            hits: [],
          };
        }
        const localX = x - rect.left;
        const localY = y - rect.top;
        const hits = stateRef.current.visibleDrawings.flatMap((drawing) =>
          (getTool(drawing.tool)?.hitTest(
            drawing,
            localX,
            localY,
            toX,
            toY,
          ) ?? []).map((hit) => ({
            id: drawing.id,
            target: hit.target,
            anchorIndex: hit.anchorIndex,
            distance: hit.distance,
          })),
        );
        return {
          insideCanvas:
            x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
          overDrawingUi: Boolean(
            element?.closest?.("[data-drawing-toolbar],[data-chart-ui]"),
          ),
          target: element
            ? `${element.tagName.toLowerCase()}.${element.className}`
            : null,
          hits,
        };
      },
      magnetPointsAtClient: (x, y) => {
        const raw = fromEvent(new PointerEvent("pointermove", {
          clientX: x,
          clientY: y,
        }));
        return {
          raw,
          strong: raw
            ? snapPointToOhlc({
              point: raw,
              candles: stateRef.current.candles,
              mode: "strong",
              toX,
              toY,
            }).point
            : null,
        };
      },
      clear: async () => {
        for (const drawing of getDefaultStore().get(drawingsAtom)) {
          removeDrawing(drawing.id);
        }
        selectDrawing(null);
        reset();
        setActiveTool("cursor");
        // The harness is a transactional test boundary. Its globals can mount
        // before fixture candles have reached the chart/time scale; clicks in
        // that window project to null and snapshot tools capture empty data.
        // Font/sidebar layout can also shift the canvas after candle hydration,
        // so require a short run of identical paintable frames rather than a
        // fixed sleep.
        await document.fonts?.ready;
        const deadline = performance.now() + 5_000;
        let previousFrameSignature = "";
        let stableFrames = 0;
        while (performance.now() < deadline && stableFrames < 8) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const candles =
            ctxRef.current?.candles ?? getDefaultStore().get(candlesAtom);
          const rect = canvasRef.current?.getBoundingClientRect();
          const mainPaneRect =
            ctxRef.current?.chart.panes()[0]?.getHTMLElement()?.getBoundingClientRect();
          const projectedCenter = mainPaneRect
            ? fromEvent(new PointerEvent("pointermove", {
                clientX: mainPaneRect.left + mainPaneRect.width / 2,
                clientY: mainPaneRect.top + mainPaneRect.height / 2,
              }))
            : null;
          const candleSignature = candles.length >= 2
            ? `${candles.length}:${candles[0].time}:${candles[candles.length - 1].time}`
            : "";
          const ready =
            getDefaultStore().get(workspaceReadyAtom) &&
            !!ctxRef.current &&
            !!rect &&
            rect.width > 0 &&
            rect.height > 0 &&
            !!projectedCenter &&
            candleSignature.length > 0;
          const frameSignature = ready
            ? [
                candleSignature,
                rect.x.toFixed(1),
                rect.y.toFixed(1),
                rect.width.toFixed(1),
                rect.height.toFixed(1),
                ctxRef.current?.version ?? 0,
              ].join(":")
            : "";
          stableFrames = ready && frameSignature === previousFrameSignature
            ? stableFrames + 1
            : 0;
          previousFrameSignature = frameSignature;
        }
        if (stableFrames < 8) {
          const chartSnapshot = window.__chartInteractionTest?.snapshot();
          const currentCandles =
            ctxRef.current?.candles ?? getDefaultStore().get(candlesAtom);
          throw new Error(
            [
              "Drawing interaction fixture did not reach a paintable viewport",
              `candles=${currentCandles.length}`,
              `canvas=${JSON.stringify(canvasRef.current?.getBoundingClientRect().toJSON() ?? null)}`,
              `visibleRange=${JSON.stringify(chartSnapshot?.visibleTimeRange ?? null)}`,
              `logicalRange=${JSON.stringify(chartSnapshot?.viewport.logicalRange ?? null)}`,
            ].join("; "),
          );
        }
      },
      changeSymbol: (nextSymbol) => setSymbol(nextSymbol),
      changeTimeframe: (nextTimeframe) => setTimeframe(nextTimeframe),
    };
    return () => {
      delete window.__drawingInteractionTest;
    };
  }, [commandManager, fromEvent, machineRef, removeDrawing, reset, selectDrawing, setActiveTool, setSymbol, setTimeframe, toX, toY]);

  // While a drawing is being created or dragged/resized, freeze the chart's
  // pan & zoom. Otherwise a fast pointer move leaks through to the chart's
  // pressedMouseMove handler and scrolls the view ("view jump"). The freeze is
  // applied *synchronously* at pointerdown via `freezeChart` (see the manager)
  // to win the race against the first leaked pointermove of a fast drag; this
  // effect is the reconciling backstop that restores full pan/zoom the instant
  // the interaction returns to Idle.
  useEffect(() => {
    const chart = ctxRef.current?.chart;
    if (!chart) return;
    const busy = machine.state !== "Idle";
    setChartInteractionLocked(chart, "drawing-state", busy);
    return () => setChartInteractionLocked(chart, "drawing-state", false);
  }, [machine.state]);

  useEffect(() => {
    if (!ctx) return;
    const loop = createRenderLoop({
      canvasRef,
      toX,
      toY,
      getData: () => ({
        drawings: stateRef.current.visibleDrawings,
        drawingsHidden: stateRef.current.drawingsHidden,
        selectedDrawingId: stateRef.current.selectedDrawingId,
        selectedDrawingIds: stateRef.current.selectedDrawingIds,
        drawColor: stateRef.current.drawColor,
        activeTool: stateRef.current.activeTool,
        machine: machineRef.current,
        chartReady: !!ctxRef.current,
        livePoints: livePointsRef.current,
        draggingId: drawingIdRef.current,
        hoveredId: hoveredIdRef.current,
        barIntervalSeconds: stateRef.current.barIntervalSeconds,
        marketContext: stateRef.current.marketContext,
      }),
      onVersionChange: (cb) => {
        const c = ctxRef.current?.chart;
        if (!c) return () => {};
        const unsubscribeViewportEvents = subscribeChartViewportEvents(c, cb);
        const ro = new ResizeObserver(() => cb());
        const el = canvasRef.current?.parentElement;
        if (el) ro.observe(el);
        return () => {
          unsubscribeViewportEvents();
          ro.disconnect();
        };
      },
    });
    markDirtyRef.current = loop.markDirty;
    // Position tools highlight their profit/risk zone once price reaches the
    // target / stop. Price changes don't touch any drawing-data signature, so
    // the render memo would skip the repaint — force one on each candle tick
    // (only when a long/short tool is present, to keep idle charts cheap).
    // Also detect TP/SL hits and persist tradeStatus so hard refreshes keep the
    // first resolved outcome even if the initial candle window is incomplete.
    // This subscription is non-React.
    const store = getDefaultStore();
    const unsubPrice = store.sub(candlesAtom, () => {
      const drawings = stateRef.current.drawings;
      const candles = store.get(candlesAtom);
      const lifecycle = reconcileDrawingLifecycle({
        drawings,
        samples: candles,
        draggingId: drawingIdRef.current,
        isEligible: (drawing) =>
          getDrawingToolManifestEntry(drawing.tool).lifecycleExtension ===
          "position-resolution",
        resolveHit: resolvePositionHit,
        samplesCoverEntry: positionHitDataCoversEntry,
      });
      for (const update of lifecycle.updates) updateDrawing(update);
      if (lifecycle.hasEligible) loop.markDirty(true);
    });
    return () => {
      unsubPrice();
      loop.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!ctx]);

  // Capability-contributed selection text overlays. Hidden while geometry is
  // transient so the editor never detaches from the committed drawing.
  const shapeLabelTarget = machine.state === "Idle"
    ? resolveSelectionTextOverlay(
        visibleDrawings,
        selectedDrawingId,
        "shape-center",
        toX,
        toY,
      )
    : null;
  const shapeTextEditorTarget =
    textEditSession?.editorKind === "shape-center"
      ? resolveSelectionTextOverlay(
          visibleDrawings,
          textEditSession.drawingId,
          "shape-center",
          toX,
          toY,
        )
      : null;
  const trendLineTextTarget = machine.state === "Idle"
    ? resolveSelectionTextOverlay(
        visibleDrawings,
        selectedDrawingId,
        "line-midpoint",
        toX,
        toY,
      )
    : null;
  const trendLineTextEditorTarget =
    textEditSession?.editorKind === "line-midpoint"
      ? resolveSelectionTextOverlay(
          visibleDrawings,
          textEditSession.drawingId,
          "line-midpoint",
          toX,
          toY,
        )
      : null;
  const overlayViewport = {
    width: canvasRef.current?.getBoundingClientRect().width ?? 0,
    height: canvasRef.current?.getBoundingClientRect().height ?? 0,
    market: marketContext,
  };
  const axisPriceTextTarget = machine.state === "Idle"
    ? resolveSelectionTextOverlay(
        visibleDrawings,
        selectedDrawingId,
        "axis-price",
        toX,
        toY,
        overlayViewport,
      )
    : null;
  const axisTimeTextTarget = machine.state === "Idle"
    ? resolveSelectionTextOverlay(
        visibleDrawings,
        selectedDrawingId,
        "axis-time",
        toX,
        toY,
        overlayViewport,
      )
    : null;
  const axisPriceTextEditorTarget =
    textEditSession?.editorKind === "axis-price"
      ? resolveSelectionTextOverlay(
          visibleDrawings,
          textEditSession.drawingId,
          "axis-price",
          toX,
          toY,
          overlayViewport,
        )
      : null;
  const axisTimeTextEditorTarget =
    textEditSession?.editorKind === "axis-time"
      ? resolveSelectionTextOverlay(
          visibleDrawings,
          textEditSession.drawingId,
          "axis-time",
          toX,
          toY,
          overlayViewport,
        )
      : null;

  return (
    <>
      <canvas
        ref={canvasRef}
        data-drawing-canvas
        className="absolute inset-0 h-full w-full"
        style={{ cursor: cursorStyle, pointerEvents: "none", zIndex: 5 }}
      />
      <DrawingSettingsToolbar />
      {ctxMenu && (
        <DrawingContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
      {shapeLabelTarget && textEditSession?.editorKind !== "shape-center" && (
        <button
          type="button"
          data-chart-ui
          aria-label={shapeLabelTarget.drawing.text ? "Edit text" : "Add text"}
          title={shapeLabelTarget.drawing.text ? "Edit text" : "Add text"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            setTextEditSession(
              TextEditSession.attached(shapeLabelTarget.drawing, "shape-center"),
            )
          }
          className={
            shapeLabelTarget.drawing.text
              ? "absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-text"
              : "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[12px] text-ink-muted hover:bg-terminal-hover/70 hover:text-ink"
          }
          style={{
            left: shapeLabelTarget.x,
            top: shapeLabelTarget.y,
            width: shapeLabelTarget.drawing.text
              ? Math.min(shapeLabelTarget.width, 160)
              : undefined,
            height: shapeLabelTarget.drawing.text ? 22 : undefined,
            pointerEvents: "auto",
          }}
        >
          {!shapeLabelTarget.drawing.text && (
            <>
              <Plus size={13} /> Add text
            </>
          )}
        </button>
      )}
      {trendLineTextTarget && textEditSession?.editorKind !== "line-midpoint" && (
        <button
          type="button"
          data-chart-ui
          aria-label={
            trendLineTextTarget.drawing.text ? "Edit text" : "Add text"
          }
          title={trendLineTextTarget.drawing.text ? "Edit text" : "Add text"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            setTextEditSession(
              TextEditSession.attached(
                trendLineTextTarget.drawing,
                "line-midpoint",
              ),
            )
          }
          className="absolute z-10 cursor-text"
          style={{
            left: trendLineTextTarget.x,
            top: trendLineTextTarget.y,
            width: trendLineTextTarget.drawing.text
              ? Math.max(
                  72,
                  Math.min(trendLineTextTarget.drawing.text.length * 7 + 24, 220),
                )
              : 104,
            height: 24,
            transform: `translate(-50%, -50%) rotate(${trendLineTextTarget.angle}deg)`,
            pointerEvents: "auto",
            background: "transparent",
          }}
        />
      )}
      {axisPriceTextTarget && textEditSession?.editorKind !== "axis-price" && (
        <button
          type="button"
          data-chart-ui
          aria-label={axisPriceTextTarget.drawing.text ? "Edit price-line text" : "Add price-line text"}
          title={axisPriceTextTarget.drawing.text ? "Edit price-line text" : "Add price-line text"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() =>
            setTextEditSession(
              TextEditSession.attached(axisPriceTextTarget.drawing, "axis-price"),
            )
          }
          className="absolute z-10 cursor-text"
          style={{
            left: axisPriceTextTarget.x,
            top: axisPriceTextTarget.y,
            width: axisPriceTextTarget.width,
            height: axisPriceTextTarget.height ?? 20,
            transform: "translate(-50%, -50%)",
            pointerEvents: "auto",
            background: "transparent",
          }}
        />
      )}
      {axisTimeTextTarget && textEditSession?.editorKind !== "axis-time" && (
        <button
          type="button"
          data-chart-ui
          aria-label={axisTimeTextTarget.drawing.text ? "Edit time-line text" : "Add time-line text"}
          title={axisTimeTextTarget.drawing.text ? "Edit time-line text" : "Add time-line text"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() =>
            setTextEditSession(
              TextEditSession.attached(axisTimeTextTarget.drawing, "axis-time"),
            )
          }
          className="absolute z-10 cursor-text"
          style={{
            left: axisTimeTextTarget.x,
            top: axisTimeTextTarget.y,
            width: axisTimeTextTarget.width,
            height: axisTimeTextTarget.height ?? 20,
            transform: "translate(-50%, -50%)",
            pointerEvents: "auto",
            background: "transparent",
          }}
        />
      )}
      {textEditSession?.editorKind === "shape-center" && shapeTextEditorTarget && (
        <TextEditor
          key={textEditSession.drawingId}
          initialText={textEditSession.initialText}
          x={shapeTextEditorTarget.x}
          y={shapeTextEditorTarget.y}
          onDraftChangeAction={(text) => {
            setTextEditSession((current) => current?.withDraft(text) ?? null);
          }}
          onSaveAction={(text) => {
            applyTextEditOutcome(textEditSession.finish(text));
          }}
          onCancelAction={() => {
            applyTextEditOutcome(textEditSession.cancel());
          }}
        />
      )}
      {textEditSession?.editorKind === "line-midpoint" && trendLineTextEditorTarget && (
        <TextEditor
          key={textEditSession.drawingId}
          initialText={textEditSession.initialText}
          x={trendLineTextEditorTarget.x}
          y={trendLineTextEditorTarget.y}
          onDraftChangeAction={(text) => {
            setTextEditSession((current) => current?.withDraft(text) ?? null);
          }}
          onSaveAction={(text) => {
            applyTextEditOutcome(textEditSession.finish(text));
          }}
          onCancelAction={() => {
            applyTextEditOutcome(textEditSession.cancel());
          }}
        />
      )}
      {textEditSession?.editorKind === "axis-price" && axisPriceTextEditorTarget && (
        <TextEditor
          key={textEditSession.drawingId}
          initialText={textEditSession.initialText}
          x={axisPriceTextEditorTarget.x}
          y={axisPriceTextEditorTarget.y}
          onDraftChangeAction={(text) => {
            setTextEditSession((current) => current?.withDraft(text) ?? null);
          }}
          onSaveAction={(text) => {
            applyTextEditOutcome(textEditSession.finish(text));
          }}
          onCancelAction={() => {
            applyTextEditOutcome(textEditSession.cancel());
          }}
        />
      )}
      {textEditSession?.editorKind === "axis-time" && axisTimeTextEditorTarget && (
        <TextEditor
          key={textEditSession.drawingId}
          initialText={textEditSession.initialText}
          x={axisTimeTextEditorTarget.x}
          y={axisTimeTextEditorTarget.y}
          onDraftChangeAction={(text) => {
            setTextEditSession((current) => current?.withDraft(text) ?? null);
          }}
          onSaveAction={(text) => {
            applyTextEditOutcome(textEditSession.finish(text));
          }}
          onCancelAction={() => {
            applyTextEditOutcome(textEditSession.cancel());
          }}
        />
      )}
      {textEditSession?.editorKind === "standalone" && textEditSession.screenPoint && (
        <TextEditor
          key={textEditSession.drawingId}
          initialText=""
          x={textEditSession.screenPoint.x}
          y={textEditSession.screenPoint.y}
          onSaveAction={(text) => {
            applyTextEditOutcome(textEditSession.finish(text));
          }}
          onCancelAction={() => {
            applyTextEditOutcome(textEditSession.cancel());
          }}
        />
      )}
    </>
  );
}
