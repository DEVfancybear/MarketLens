"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
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
  selectAllAtom,
} from "@/store/chartStore";
import type { Drawing, Point } from "@/types";
import { DrawingContextMenu } from "./DrawingContextMenu";
import { DrawingSettingsToolbar } from "./DrawingSettingsToolbar";
import {
  useDrawingInteractionManager,
  createRenderLoop,
} from "./drawing/engine/DrawingEngine";
import { useCommandHistory } from "./drawing/history/useCommandHistory";
import { CreateDrawingCommand } from "./drawing/history/CommandManager";
import { TextEditor } from "./drawing/TextEditor";
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
  const selectAll = useSetAtom(selectAllAtom);

  const [textEdit, setTextEdit] = useState<{
    drawingId: string;
    x: number;
    y: number;
    color: string;
    point: Point;
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
      addDrawing(d);
      execute(new CreateDrawingCommand(addDrawing, removeDrawing, d));
    },
    [addDrawing, removeDrawing, execute],
  );
  const scheduleRedraw = useCallback(() => {
    markDirtyRef.current();
  }, []);

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
        c.timeScale().subscribeVisibleLogicalRangeChange(() => cb());
        const ro = new ResizeObserver(() => cb());
        const el = canvasRef.current?.parentElement;
        if (el) ro.observe(el);
        return () => {
          ro.disconnect();
        };
      },
    });
    markDirtyRef.current = loop.markDirty;
    // Position tools highlight their profit/risk zone once price reaches the
    // target / stop. Price changes don't touch any drawing-data signature, so
    // the render memo would skip the repaint — force one on each candle tick
    // (only when a long/short tool is present, to keep idle charts cheap).
    // Also detect TP/SL hits and persist tradeStatus so the frozen width
    // survives pan/zoom/re-render. This subscription is non-React.
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
          // Re-derive from candles every tick — even for already-resolved
          // drawings — so a stale persisted status (e.g. a tp_hit that should
          // be sl_hit under the corrected stop-first logic) self-corrects.
          // The write below is guarded to fire only when the value changes.
          if (d.points.length >= 3) {
            const entry = d.points[0].price;
            const target = d.points[1]?.price ?? d.target ?? entry;
            const stop = d.points[2]?.price ?? d.stop ?? entry;
            const entryTime = d.points[0].time;
            const isLong = d.tool === "long";
            const candles = store.get(candlesAtom);
            let hit: {
              status: "tp_hit" | "sl_hit";
              time: number;
              price: number;
            } | null = null;
            for (const c of candles) {
              if (c.time <= entryTime) continue;
              // Stop checked before target: a single bar piercing both levels
              // resolves to a stop hit (conservative — never assume the
              // optimistic fill). Chronology across separate bars is preserved.
              if (isLong) {
                if (c.low <= stop) {
                  hit = {
                    status: "sl_hit",
                    time: c.time - entryTime,
                    price: stop,
                  };
                  break;
                }
                if (c.high >= target) {
                  hit = {
                    status: "tp_hit",
                    time: c.time - entryTime,
                    price: target,
                  };
                  break;
                }
              } else {
                if (c.high >= stop) {
                  hit = {
                    status: "sl_hit",
                    time: c.time - entryTime,
                    price: stop,
                  };
                  break;
                }
                if (c.low <= target) {
                  hit = {
                    status: "tp_hit",
                    time: c.time - entryTime,
                    price: target,
                  };
                  break;
                }
              }
            }
            // Also check live price for intra-candle hit.
            if (!hit) {
              const last = candles[candles.length - 1];
              if (last && last.time > entryTime) {
                const px = last.close;
                // Stop checked first here too (conservative on ambiguity).
                if (isLong) {
                  if (px <= stop)
                    hit = {
                      status: "sl_hit",
                      time: last.time - entryTime,
                      price: stop,
                    };
                  else if (px >= target)
                    hit = {
                      status: "tp_hit",
                      time: last.time - entryTime,
                      price: target,
                    };
                } else {
                  if (px >= stop)
                    hit = {
                      status: "sl_hit",
                      time: last.time - entryTime,
                      price: stop,
                    };
                  else if (px <= target)
                    hit = {
                      status: "tp_hit",
                      time: last.time - entryTime,
                      price: target,
                    };
                }
              }
            }
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
              d.tradeStatus === "tp_hit" ||
              d.tradeStatus === "sl_hit"
            ) {
              // Previously resolved but no longer hits anything (e.g. levels
              // edited) — clear the stale status.
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
      {textEdit && (
        <TextEditor
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
            addDrawing(fresh);
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
