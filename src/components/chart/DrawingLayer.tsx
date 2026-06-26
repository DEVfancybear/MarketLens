"use client";
import { useCallback, useEffect, useRef } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useChartStore } from "@/store/chartStore";
import type { Drawing, Point } from "@/types";
import { DrawingContextMenu } from "./DrawingContextMenu";
import {
  useDrawingInteractionManager,
  createRenderLoop,
} from "./drawing/engine/DrawingEngine";
import { useCommandHistory } from "./drawing/history/useCommandHistory";
import {
  CreateDrawingCommand,
  DeleteDrawingCommand,
  DuplicateDrawingCommand,
} from "./drawing/history/CommandManager";
import { KeyboardManager } from "./drawing/history/KeyboardManager";

export function DrawingLayer() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawings = useChartStore((s) => s.drawings);
  const activeTool = useChartStore((s) => s.activeTool);
  const drawColor = useChartStore((s) => s.drawColor);
  const selectedDrawingId = useChartStore((s) => s.selectedDrawingId);
  const selectedDrawingIds = useChartStore((s) => s.selectedDrawingIds);
  const toggleSelectDrawing = useChartStore((s) => s.toggleSelectDrawing);
  const selectAll = useChartStore((s) => s.selectAll);
  const drawingsLocked = useChartStore((s) => s.drawingsLocked);
  const drawingsHidden = useChartStore((s) => s.drawingsHidden);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const selectDrawing = useChartStore((s) => s.selectDrawing);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const duplicateDrawing = useChartStore((s) => s.duplicateDrawing);
  const setActiveTool = useChartStore((s) => s.setActiveTool);

  // ---- Command history ----
  const { commitMove, undo, redo, execute, manager } = useCommandHistory(
    addDrawing,
    removeDrawing,
    updateDrawing,
  );

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const toX = useCallback(
    (time: number) =>
      ctxRef.current?.chart
        .timeScale()
        .timeToCoordinate(time as UTCTimestamp) ?? null,
    [],
  );
  const toY = useCallback(
    (price: number) =>
      ctxRef.current?.candleSeries.priceToCoordinate(price) ?? null,
    [],
  );

  const fromEvent = useCallback((e: PointerEvent): Point | null => {
    const c = ctxRef.current;
    const canvas = canvasRef.current;
    if (!c || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const time = c.chart.timeScale().coordinateToTime(x);
    const price = c.candleSeries.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time: time as number, price };
  }, []);

  const stateRef = useRef({
    drawings: [] as Drawing[],
    activeTool: "cursor" as Drawing["tool"],
    drawColor: "#2962ff",
    drawingsLocked: false,
    ctxReady: false,
  });
  stateRef.current = {
    drawings,
    activeTool,
    drawColor,
    drawingsLocked,
    ctxReady: !!ctx,
  };

  const renderLoopRef = useRef<ReturnType<typeof createRenderLoop> | null>(
    null,
  );
  const markDirtyRef = useRef<() => void>(() => {});

  // Stable refs for history-aware store wrappers.
  const storeRef = useRef({
    addDrawing,
    removeDrawing,
    updateDrawing,
    duplicateDrawing,
    drawings,
  });
  storeRef.current = {
    addDrawing,
    removeDrawing,
    updateDrawing,
    duplicateDrawing,
    drawings,
  };

  // Wrapped addDrawing that records command history.
  const addDrawingWithHistory = useCallback(
    (d: Drawing) => {
      storeRef.current.addDrawing(d);
      execute(
        new CreateDrawingCommand(
          storeRef.current.addDrawing,
          storeRef.current.removeDrawing,
          d,
        ),
      );
    },
    [execute],
  );

  const scheduleRedraw = useCallback(() => {
    markDirtyRef.current();
  }, []);

  // ---- Drawing interaction ----
  const {
    cursorStyle,
    ctxMenu,
    setCtxMenu,
    reset,
    machineRef,
    livePointsRef,
    drawingIdRef,
  } = useDrawingInteractionManager({
    canvasRef,
    fromEvent,
    toX,
    toY,
    getState: () => stateRef.current,
    addDrawing: addDrawingWithHistory,
    updateDrawing,
    selectDrawing,
    setActiveTool,
    scheduleRedraw,
    commitMove,
  });

  // ---- Render loop ----
  useEffect(() => {
    if (!ctx) return;
    const loop = createRenderLoop({
      canvasRef,
      toX,
      toY,
      getData: () => ({
        drawings: stateRef.current.drawings,
        drawingsHidden,
        selectedDrawingId,
        drawColor,
        activeTool,
        machine: machineRef.current,
        chartReady: !!ctxRef.current,
        livePoints: livePointsRef.current,
        draggingId: drawingIdRef.current,
      }),
      onVersionChange: (cb: () => void) => {
        const chart = ctxRef.current?.chart;
        if (!chart) return () => {};
        chart.timeScale().subscribeVisibleLogicalRangeChange(() => cb());
        const ro = new ResizeObserver(() => cb());
        const el = canvasRef.current?.parentElement;
        if (el) ro.observe(el);
        return () => {
          ro.disconnect();
        };
      },
    });
    renderLoopRef.current = loop;
    markDirtyRef.current = loop.markDirty;
    return () => {
      loop.destroy();
      renderLoopRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!ctx]);

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      // Ctrl+Z → Undo
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // Ctrl+Shift+Z → Redo
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId) {
        const d = storeRef.current.drawings.find(
          (x) => x.id === selectedDrawingId,
        );
        if (d) {
          execute(
            new DeleteDrawingCommand(
              storeRef.current.addDrawing,
              storeRef.current.removeDrawing,
              d,
            ),
          );
        }
      }
      if (e.key === "Escape") {
        reset();
        setActiveTool("cursor");
      }
      // Ctrl+A → Select all
      if (e.key === "a" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === "d" && (e.ctrlKey || e.metaKey) && selectedDrawingId) {
        e.preventDefault();
        const d = storeRef.current.drawings.find(
          (x) => x.id === selectedDrawingId,
        );
        if (d) {
          // DuplicateDrawingCommand generates a valid uid internally —
          // no double-create, no empty-id corruption.
          execute(
            new DuplicateDrawingCommand(
              storeRef.current.addDrawing,
              storeRef.current.removeDrawing,
              d,
            ),
          );
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDrawingId, setActiveTool, reset, undo, redo, execute, selectAll]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ cursor: cursorStyle, pointerEvents: "none", zIndex: 5 }}
      />
      {ctxMenu && (
        <DrawingContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </>
  );
}
