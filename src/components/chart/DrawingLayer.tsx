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
} from "@/store/chartStore";
import { SHAPE_TOOLS, type Drawing, type Point } from "@/types";
import { DrawingContextMenu } from "./DrawingContextMenu";
import { DrawingSettingsToolbar } from "./DrawingSettingsToolbar";
import {
  useDrawingInteractionManager,
  createRenderLoop,
} from "./drawing/engine/DrawingEngine";
import { useCommandHistory } from "./drawing/history/useCommandHistory";
import { CreateDrawingCommand } from "./drawing/history/CommandManager";
import { TextEditor } from "./drawing/TextEditor";
import { getTool } from "./drawing/tools/ToolRegistry";
import {
  positionHitDataCoversEntry,
  resolvePositionHit,
} from "./drawing/tools/plugins/PositionTool";
import { subscribeChartViewportEvents } from "./chartViewportEvents";
import { uid } from "@/utils/id";

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
  const addDrawing = useSetAtom(addDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const selectDrawing = useSetAtom(selectDrawingAtom);
  const toggleSelectDrawing = useSetAtom(toggleSelectDrawingAtom);
  const removeDrawing = useSetAtom(removeDrawingAtom);
  const duplicateDrawing = useSetAtom(duplicateDrawingAtom);
  const setActiveTool = useSetAtom(setActiveToolAtom);
  const setEditingDrawing = useSetAtom(setEditingDrawingAtom);
  const selectAll = useSetAtom(selectAllAtom);

  const [textEdit, setTextEdit] = useState<{
    drawingId: string;
    x: number;
    y: number;
    color: string;
    point: Point;
  } | null>(null);
  // "+ Add text" (TradingView-style inner label) for the selected fillable
  // shape (rectangle/rotatedRect/circle/ellipse/triangle) — edits the
  // existing drawing's `text` in place, unlike `textEdit` above which creates
  // a brand-new standalone Text drawing.
  const [shapeTextEdit, setShapeTextEdit] = useState<{
    drawingId: string;
    initialText: string;
    draftText: string;
  } | null>(null);
  const [trendLineTextEdit, setTrendLineTextEdit] = useState<{
    drawingId: string;
    initialText: string;
    draftText: string;
  } | null>(null);

  const { commitMove, undo, redo, execute } = useCommandHistory(
    addDrawing,
    removeDrawing,
    updateDrawing,
  );
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
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
  const shapeTextEditRef = useRef(shapeTextEdit);
  shapeTextEditRef.current = shapeTextEdit;
  const trendLineTextEditRef = useRef(trendLineTextEdit);
  trendLineTextEditRef.current = trendLineTextEdit;
  const commitShapeTextEdit = useCallback(() => {
    const edit = shapeTextEditRef.current;
    if (!edit) return false;
    const text = edit.draftText.trim();
    if (text) updateDrawing({ id: edit.drawingId, patch: { text } });
    setShapeTextEdit(null);
    scheduleRedraw();
    return true;
  }, [scheduleRedraw, updateDrawing]);
  const commitShapeTextEditRef = useRef(commitShapeTextEdit);
  commitShapeTextEditRef.current = commitShapeTextEdit;
  const commitTrendLineTextEdit = useCallback(() => {
    const edit = trendLineTextEditRef.current;
    if (!edit) return false;
    const text = edit.draftText.trim();
    if (text) updateDrawing({ id: edit.drawingId, patch: { text } });
    setTrendLineTextEdit(null);
    scheduleRedraw();
    return true;
  }, [scheduleRedraw, updateDrawing]);
  const commitTrendLineTextEditRef = useRef(commitTrendLineTextEdit);
  commitTrendLineTextEditRef.current = commitTrendLineTextEdit;

  // Handle Text tool placement: create an empty drawing and show inline editor.
  const handleTextPlace = useCallback(
    (point: Point, color: string) => {
      const canvas = canvasRef.current;
      if (!canvas || !ctx) return;
      const id = uid("dw");
      const x =
        ctx.chart.timeScale().timeToCoordinate(point.time as UTCTimestamp) ?? 0;
      const y = ctx.candleSeries.priceToCoordinate(point.price) ?? 0;
      const drawing: Drawing = {
        id,
        tool: "text",
        color,
        lineWidth: 1.5,
        points: [point],
        text: "",
      };
      addDrawing(drawing);
      setTextEdit({ drawingId: id, x, y, color, point });
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
  ]);

  useEffect(() => {
    const handleShapeEditorCanvasPointerDown = (event: PointerEvent) => {
      if (!shapeTextEditRef.current && !trendLineTextEditRef.current) return;
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
      if (
        commitShapeTextEditRef.current() ||
        commitTrendLineTextEditRef.current()
      ) {
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
      if (drawing?.tool === "long" || drawing?.tool === "short") {
        setEditingDrawing(id);
      }
    },
    onTextPlace: handleTextPlace,
    freezeChart,
  });

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
      const ds = stateRef.current.drawings;
      let hasPosition = false;
      for (const d of ds) {
        if (d.tool === "long" || d.tool === "short") {
          hasPosition = true;
          // Skip while the user is dragging this drawing — its store points
          // are stale and hit detection would use the wrong geometry.
          if (drawingIdRef.current === d.id) continue;
          // Use the SAME resolver as the renderer. It keeps persisted hits when
          // a hard refresh initially loads candles that start after entry time,
          // but still lets complete history correct older stale persisted data.
          if (d.points.length >= 3) {
            const entryTime = d.points[0].time;
            const candles = store.get(candlesAtom);
            const found = resolvePositionHit(d, candles);
            // hitTime is persisted as an OFFSET from entry so the hit label
            // follows the position when it is dragged.
            const hit = found
              ? {
                  status: found.status,
                  time: found.time - entryTime,
                  price: found.price,
                }
              : null;
            // Write only when the resolved hit actually differs from what is
            // already stored — otherwise this per-tick subscription would loop
            // updating the store with identical values.
            if (hit) {
              if (
                d.tradeStatus !== hit.status ||
                d.hitTime !== hit.time ||
                d.hitPrice !== hit.price
              ) {
                updateDrawing({
                  id: d.id,
                  patch: {
                    tradeStatus: hit.status,
                    hitTime: hit.time,
                    hitPrice: hit.price,
                  },
                });
              }
            } else if (
              positionHitDataCoversEntry(d, candles) &&
              (d.tradeStatus === "tp_hit" || d.tradeStatus === "sl_hit")
            ) {
              // Previously resolved but no longer hits anything (e.g. levels
              // edited, or still pending fill) — clear the stale status.
              updateDrawing({
                id: d.id,
                patch: {
                  tradeStatus: undefined,
                  hitTime: undefined,
                  hitPrice: undefined,
                },
              });
            }
          }
        }
      }
      if (hasPosition) {
        loop.markDirty(true);
      }
    });
    return () => {
      unsubPrice();
      loop.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!ctx]);

  // "+ Add text" affordance for the selected fillable shape (TradingView
  // shows this centered inside Rectangle/Ellipse/etc. once selected). Hidden
  // mid-drag/resize — the live preview position and this projection would
  // otherwise disagree until the drag commits.
  const selectedShape =
    machine.state === "Idle"
      ? (drawings.find(
          (d) => d.id === selectedDrawingId && SHAPE_TOOLS.includes(d.tool),
        ) ?? null)
      : null;
  const shapeLabelBox = selectedShape
    ? (getTool(selectedShape.tool)?.boundingBox(selectedShape, toX, toY) ?? null)
    : null;
  const shapeLabelTarget =
    selectedShape && shapeLabelBox
      ? {
          drawing: selectedShape,
          cx: shapeLabelBox.x + shapeLabelBox.w / 2,
          cy: shapeLabelBox.y + shapeLabelBox.h / 2,
          w: shapeLabelBox.w,
        }
      : null;
  const editedShape = shapeTextEdit
    ? (drawings.find(
        (d) => d.id === shapeTextEdit.drawingId && SHAPE_TOOLS.includes(d.tool),
      ) ?? null)
    : null;
  const editedShapeBox = editedShape
    ? (getTool(editedShape.tool)?.boundingBox(editedShape, toX, toY) ?? null)
    : null;
  const shapeTextEditorTarget =
    editedShape && editedShapeBox
      ? {
          x: editedShapeBox.x + editedShapeBox.w / 2,
          y: editedShapeBox.y + editedShapeBox.h / 2,
        }
      : null;
  const selectedTrendLine =
    machine.state === "Idle"
      ? (drawings.find(
          (d) => d.id === selectedDrawingId && d.tool === "trendline",
        ) ?? null)
      : null;
  const trendLineTextBox = selectedTrendLine
    ? projectTrendLineTextTarget(selectedTrendLine, toX, toY)
    : null;
  const trendLineTextTarget =
    selectedTrendLine && trendLineTextBox
      ? { drawing: selectedTrendLine, ...trendLineTextBox }
      : null;
  const editedTrendLine = trendLineTextEdit
    ? (drawings.find(
        (d) => d.id === trendLineTextEdit.drawingId && d.tool === "trendline",
      ) ?? null)
    : null;
  const trendLineTextEditorTarget = editedTrendLine
    ? projectTrendLineTextTarget(editedTrendLine, toX, toY)
    : null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ cursor: cursorStyle, pointerEvents: "none", zIndex: 5 }}
      />
      <DrawingSettingsToolbar />
      {ctxMenu && (
        <DrawingContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
      {shapeLabelTarget && !shapeTextEdit && (
        <button
          type="button"
          data-chart-ui
          aria-label={shapeLabelTarget.drawing.text ? "Edit text" : "Add text"}
          title={shapeLabelTarget.drawing.text ? "Edit text" : "Add text"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            setShapeTextEdit({
              drawingId: shapeLabelTarget.drawing.id,
              initialText: shapeLabelTarget.drawing.text ?? "",
              draftText: shapeLabelTarget.drawing.text ?? "",
            })
          }
          className={
            shapeLabelTarget.drawing.text
              ? "absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-text"
              : "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[12px] text-ink-muted hover:bg-terminal-hover/70 hover:text-ink"
          }
          style={{
            left: shapeLabelTarget.cx,
            top: shapeLabelTarget.cy,
            width: shapeLabelTarget.drawing.text
              ? Math.min(shapeLabelTarget.w, 160)
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
      {trendLineTextTarget && !trendLineTextEdit && (
        <button
          type="button"
          data-chart-ui
          aria-label={
            trendLineTextTarget.drawing.text ? "Edit text" : "Add text"
          }
          title={trendLineTextTarget.drawing.text ? "Edit text" : "Add text"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() =>
            setTrendLineTextEdit({
              drawingId: trendLineTextTarget.drawing.id,
              initialText: trendLineTextTarget.drawing.text ?? "",
              draftText: trendLineTextTarget.drawing.text ?? "",
            })
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
      {shapeTextEdit && shapeTextEditorTarget && (
        <TextEditor
          key={shapeTextEdit.drawingId}
          initialText={shapeTextEdit.initialText}
          x={shapeTextEditorTarget.x}
          y={shapeTextEditorTarget.y}
          onDraftChangeAction={(text) => {
            setShapeTextEdit((current) =>
              current?.drawingId === shapeTextEdit.drawingId
                ? { ...current, draftText: text }
                : current,
            );
          }}
          onSaveAction={(text) => {
            updateDrawing({ id: shapeTextEdit.drawingId, patch: { text } });
            setShapeTextEdit(null);
            scheduleRedraw();
          }}
          onCancelAction={() => {
            setShapeTextEdit(null);
            scheduleRedraw();
          }}
        />
      )}
      {trendLineTextEdit && trendLineTextEditorTarget && (
        <TextEditor
          key={trendLineTextEdit.drawingId}
          initialText={trendLineTextEdit.initialText}
          x={trendLineTextEditorTarget.x}
          y={trendLineTextEditorTarget.y}
          onDraftChangeAction={(text) => {
            setTrendLineTextEdit((current) =>
              current?.drawingId === trendLineTextEdit.drawingId
                ? { ...current, draftText: text }
                : current,
            );
          }}
          onSaveAction={(text) => {
            updateDrawing({ id: trendLineTextEdit.drawingId, patch: { text } });
            setTrendLineTextEdit(null);
            scheduleRedraw();
          }}
          onCancelAction={() => {
            setTrendLineTextEdit(null);
            scheduleRedraw();
          }}
        />
      )}
      {textEdit && (
        <TextEditor
          key={textEdit.drawingId}
          initialText=""
          x={textEdit.x}
          y={textEdit.y}
          onSaveAction={(text) => {
            // Remove the empty placeholder and create a fresh drawing with text.
            removeDrawing(textEdit.drawingId);
            const fresh: Drawing = {
              id: textEdit.drawingId,
              tool: "text",
              color: textEdit.color,
              lineWidth: 1.5,
              points: [textEdit.point],
              text,
            };
            execute(new CreateDrawingCommand(addDrawing, removeDrawing, fresh));
            setTextEdit(null);
            scheduleRedraw();
          }}
          onCancelAction={() => {
            removeDrawing(textEdit.drawingId);
            setTextEdit(null);
            scheduleRedraw();
          }}
        />
      )}
    </>
  );
}

function projectTrendLineTextTarget(
  drawing: Drawing,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
): { x: number; y: number; angle: number; width: number } | null {
  const p0 = drawing.points[0];
  const p1 = drawing.points[1];
  if (!p0 || !p1) return null;
  const x1 = toX(p0.time);
  const y1 = toY(p0.price);
  const x2 = toX(p1.time);
  const y2 = toY(p1.price);
  if (x1 == null || y1 == null || x2 == null || y2 == null) return null;
  let angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  return {
    x: (x1 + x2) / 2,
    y: (y1 + y2) / 2,
    angle,
    width: Math.hypot(x2 - x1, y2 - y1),
  };
}
