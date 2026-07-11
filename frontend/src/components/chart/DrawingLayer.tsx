"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { Plus } from "lucide-react";
import { useChartCtx } from "./ChartContext";
import { useAtomValue, useSetAtom, getDefaultStore } from "jotai";
import {
  candlesAtom,
  drawingsAtom,
  activeToolAtom,
  drawColorAtom,
  selectedDrawingIdAtom,
  selectedDrawingIdsAtom,
  drawingsLockedAtom,
  drawingsHiddenAtom,
  addDrawingAtom,
  updateDrawingAtom,
  selectDrawingAtom,
  toggleSelectDrawingAtom,
  removeDrawingAtom,
  duplicateDrawingAtom,
  setActiveToolAtom,
  setEditingDrawingAtom,
  selectAllAtom,
  symbolAtom,
  setSymbolAtom,
} from "@/store/chartStore";
import { type Drawing, type Point } from "@/types";
import { getDrawingToolManifestEntry } from "@/types/drawingToolManifest";
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
} from "./drawing/tools/plugins/PositionTool";
import { subscribeChartViewportEvents } from "./chartViewportEvents";
import { uid } from "@/utils/id";
import { runDrawingAdapterContractAudit } from "./drawing/testing/adapterContractAudit";
import type { DrawingInteractionTestHarness } from "./drawing/testing/testHarnessTypes";
import { reconcileDrawingLifecycle } from "./drawing/lifecycle/drawingLifecycle";
import { resolveSelectionTextOverlay } from "./drawing/overlays/drawingOverlayTargets";

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
  const selectedDrawingId = useAtomValue(selectedDrawingIdAtom);
  const selectedDrawingIds = useAtomValue(selectedDrawingIdsAtom);
  const drawingsLocked = useAtomValue(drawingsLockedAtom);
  const drawingsHidden = useAtomValue(drawingsHiddenAtom);
  const symbol = useAtomValue(symbolAtom);
  const addDrawing = useSetAtom(addDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const selectDrawing = useSetAtom(selectDrawingAtom);
  const toggleSelectDrawing = useSetAtom(toggleSelectDrawingAtom);
  const removeDrawing = useSetAtom(removeDrawingAtom);
  const duplicateDrawing = useSetAtom(duplicateDrawingAtom);
  const setActiveTool = useSetAtom(setActiveToolAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const setEditingDrawing = useSetAtom(setEditingDrawingAtom);
  const selectAll = useSetAtom(selectAllAtom);

  const [textEditSession, setTextEditSession] = useState<TextEditSession | null>(null);

  const { commitMove, undo, redo, execute } = useCommandHistory(
    addDrawing,
    removeDrawing,
    updateDrawing,
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const xFallbackRef = useRef<{
    version: number;
    candleCount: number;
    anchorIndex: number;
    anchorTime: number;
    anchorX: number;
    refIndex: number;
    refTime: number;
    secondsPerBar: number;
    pxPerBar: number;
  } | null>(null);
  const toX = useCallback((time: number) => {
    const chart = ctxRef.current?.chart;
    if (!chart) return null;
    const ts = chart.timeScale();
    const x = ts.timeToCoordinate(time as UTCTimestamp);
    if (x != null) return x;
    // Whitespace fallback: the time lies past the last bar (or before the
    // first), where timeToCoordinate() returns null. Extrapolate linearly from
    // the uniform bar spacing of two anchor candles that DO project, so the
    // right edge of a position box keeps tracking instead of collapsing onto
    // the last candle.
    const candles = getDefaultStore().get(candlesAtom);
    if (candles.length < 2) return null;
    const version = ctxRef.current?.version ?? 0;
    const cached = xFallbackRef.current;
    if (
      cached &&
      cached.version === version &&
      cached.candleCount === candles.length &&
      cached.anchorIndex < candles.length &&
      cached.refIndex < candles.length &&
      candles[cached.anchorIndex]?.time === cached.anchorTime &&
      candles[cached.refIndex]?.time === cached.refTime
    ) {
      return (
        cached.anchorX +
        ((time - cached.anchorTime) / cached.secondsPerBar) * cached.pxPerBar
      );
    }
    // Anchor = nearest candle (scanning back from the last) that still projects.
    let i = candles.length - 1;
    let cx: number | null = null;
    for (; i >= 1; i--) {
      cx = ts.timeToCoordinate(candles[i].time as UTCTimestamp);
      if (cx != null) break;
    }
    if (cx == null) return null;
    // Reference = an earlier candle that also projects, to measure bar width.
    let px: number | null = null;
    let j = i - 1;
    for (; j >= 0; j--) {
      px = ts.timeToCoordinate(candles[j].time as UTCTimestamp);
      if (px != null) break;
    }
    if (px == null) return cx;
    const span = i - j;
    const barW = (cx - px) / span; // pixels per bar
    const iv = (candles[i].time - candles[j].time) / span || 1; // seconds per bar
    xFallbackRef.current = {
      version,
      candleCount: candles.length,
      anchorIndex: i,
      anchorTime: candles[i].time,
      anchorX: cx,
      refIndex: j,
      refTime: candles[j].time,
      secondsPerBar: iv,
      pxPerBar: barW,
    };
    return cx + ((time - candles[i].time) / iv) * barW;
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
    ctxRef.current?.chart?.applyOptions({
      handleScroll: !busy,
      handleScale: !busy,
    });
  }, []);
  const fromEvent = useCallback((e: PointerEvent): Point | null => {
    const c = ctxRef.current;
    const cv = canvasRef.current;
    if (!c || !cv) return null;
    const r = cv.getBoundingClientRect();
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
    if (t == null) {
      // Whitespace past the last bar: coordinateToTime returns null.
      // Extrapolate using bar-aligned times so timeToCoordinate can map
      // them back.  Non-integer times can produce null projections.
      const logical = ts.coordinateToLogical(lx);
      const candles = getDefaultStore().get(candlesAtom);
      if (logical != null && candles.length >= 2) {
        const lastIdx = candles.length - 1;
        const interval = candles[lastIdx].time - candles[lastIdx - 1].time;
        const idx = Math.round(logical);
        t = candles[lastIdx].time + (idx - lastIdx) * interval;
      }
    }
    const p = c.candleSeries.coordinateToPrice(ly);
    if (t == null || p == null) return null;
    return { time: t as number, price: p };
  }, []);

  const stateRef = useRef({
    drawings: [] as Drawing[],
    activeTool: "cursor" as Drawing["tool"],
    drawColor: "#2962ff",
    drawingsLocked: false,
    ctxReady: false,
    drawingsHidden: false,
    selectedDrawingId: null as string | null,
    selectedDrawingIds: new Set<string>(),
  });
  stateRef.current = {
    drawings,
    activeTool,
    drawColor,
    drawingsLocked,
    ctxReady: !!ctx,
    drawingsHidden,
    selectedDrawingId,
    selectedDrawingIds,
  };

  const markDirtyRef = useRef<() => void>(() => {});
  const addDrawingWithHistory = useCallback(
    (d: Drawing) => {
      // `execute()` runs the command immediately (CreateDrawingCommand.execute()
      // calls addDrawing itself) and records it for undo — do NOT also call
      // addDrawing(d) directly here, or every new drawing gets inserted twice
      // under the same id (confirmed via a real repro: two identical entries
      // with an identical id in the persisted drawings array).
      execute(new CreateDrawingCommand(addDrawing, removeDrawing, d));
    },
    [addDrawing, removeDrawing, execute],
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
        id,
        tool,
        color,
        lineWidth: getDrawingToolManifestEntry(tool).defaultProperties.lineWidth,
        points: [point],
        text: "",
      };
      addDrawing(drawing);
      setTextEditSession(TextEditSession.standalone(drawing, { x, y }));
    },
    [ctx, addDrawing],
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
    selectedDrawingId,
    selectedDrawingIds,
    drawingsHidden,
    drawColor,
    activeTool,
    symbol,
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
    getState: () => stateRef.current,
    addDrawing: addDrawingWithHistory,
    updateDrawing,
    removeDrawing,
    selectDrawing,
    toggleSelectDrawing,
    setActiveTool,
    scheduleRedraw,
    commitMove,
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
    freezeChart,
    cancellationKey: symbol,
  });

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__drawingInteractionTest = {
      snapshot: () => {
        const rect = canvasRef.current?.getBoundingClientRect();
        return {
          drawings: structuredClone(stateRef.current.drawings),
          activeTool: stateRef.current.activeTool,
          selectedDrawingId: stateRef.current.selectedDrawingId,
          selectedDrawingIds: [...stateRef.current.selectedDrawingIds],
          machineState: machineRef.current?.state ?? "Idle",
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
        const drawing = stateRef.current.drawings.find((item) => item.id === id);
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
        const hits = stateRef.current.drawings.flatMap((drawing) =>
          (getTool(drawing.tool)?.hitTest(
            drawing,
            localX,
            localY,
            toX,
            toY,
          ) ?? []).map((hit) => ({
            id: drawing.id,
            target: hit.target,
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
      clear: () => {
        for (const drawing of stateRef.current.drawings) removeDrawing(drawing.id);
        selectDrawing(null);
        reset();
        setActiveTool("cursor");
      },
      changeSymbol: (nextSymbol) => setSymbol(nextSymbol),
    };
    return () => {
      delete window.__drawingInteractionTest;
    };
  }, [machineRef, removeDrawing, reset, selectDrawing, setActiveTool, setSymbol, toX, toY]);

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
    chart.applyOptions({ handleScroll: !busy, handleScale: !busy });
  }, [machine.state]);

  useEffect(() => {
    if (!ctx) return;
    const loop = createRenderLoop({
      canvasRef,
      toX,
      toY,
      getData: () => ({
        drawings: stateRef.current.drawings,
        drawingsHidden: stateRef.current.drawingsHidden,
        selectedDrawingId: stateRef.current.selectedDrawingId,
        selectedDrawingIds: stateRef.current.selectedDrawingIds,
        drawColor,
        activeTool,
        machine: machineRef.current,
        chartReady: !!ctxRef.current,
        livePoints: livePointsRef.current,
        draggingId: drawingIdRef.current,
        hoveredId: hoveredIdRef.current,
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
        drawings,
        selectedDrawingId,
        "shape-center",
        toX,
        toY,
      )
    : null;
  const shapeTextEditorTarget =
    textEditSession?.editorKind === "shape-center"
      ? resolveSelectionTextOverlay(
          drawings,
          textEditSession.drawingId,
          "shape-center",
          toX,
          toY,
        )
      : null;
  const trendLineTextTarget = machine.state === "Idle"
    ? resolveSelectionTextOverlay(
        drawings,
        selectedDrawingId,
        "line-midpoint",
        toX,
        toY,
      )
    : null;
  const trendLineTextEditorTarget =
    textEditSession?.editorKind === "line-midpoint"
      ? resolveSelectionTextOverlay(
          drawings,
          textEditSession.drawingId,
          "line-midpoint",
          toX,
          toY,
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
