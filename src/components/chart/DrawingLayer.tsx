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
import { CreateDrawingCommand } from "./drawing/history/CommandManager";

export function DrawingLayer() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawings = useChartStore((s) => s.drawings);
  const activeTool = useChartStore((s) => s.activeTool);
  const drawColor = useChartStore((s) => s.drawColor);
  const selectedDrawingId = useChartStore((s) => s.selectedDrawingId);
  const selectedDrawingIds = useChartStore((s) => s.selectedDrawingIds);
  const drawingsLocked = useChartStore((s) => s.drawingsLocked);
  const drawingsHidden = useChartStore((s) => s.drawingsHidden);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const selectDrawing = useChartStore((s) => s.selectDrawing);
  const toggleSelectDrawing = useChartStore((s) => s.toggleSelectDrawing);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const duplicateDrawing = useChartStore((s) => s.duplicateDrawing);
  const setActiveTool = useChartStore((s) => s.setActiveTool);
  const selectAll = useChartStore((s) => s.selectAll);

  const { commitMove, undo, redo, execute } = useCommandHistory(
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
    const cv = canvasRef.current;
    if (!c || !cv) return null;
    const r = cv.getBoundingClientRect();
    const t = c.chart.timeScale().coordinateToTime(e.clientX - r.left);
    const p = c.candleSeries.coordinateToPrice(e.clientY - r.top);
    if (t == null || p == null) return null;
    return { time: t as number, price: p };
  }, []);

  const stateRef = useRef({
    drawings: [] as Drawing[],
    activeTool: "cursor" as Drawing["tool"],
    drawColor: "#2962ff",
    drawingsLocked: false,
    ctxReady: false,
    selectedDrawingId: null as string | null,
    selectedDrawingIds: new Set<string>(),
  });
  stateRef.current = {
    drawings,
    activeTool,
    drawColor,
    drawingsLocked,
    ctxReady: !!ctx,
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

  const {
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
  });

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
    return () => {
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
      {ctxMenu && (
        <DrawingContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </>
  );
}
