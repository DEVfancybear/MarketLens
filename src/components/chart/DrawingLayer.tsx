"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useAtomValue, useSetAtom } from "jotai";
import {
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
    // The canvas, the chart container, and the time-scale pane all share the same
    // left edge and CSS-pixel width, so the local X maps 1:1 to a time-scale
    // coordinate. Do NOT rescale by timeScale().width() (which excludes the right
    // price axis) — that compresses every click's X and shifts hit-testing along
    // the line, making endpoint grabs miss and select the body instead. This
    // matches PriceChart's own coordinateToTime(localX) usage.
    const lx = e.clientX - r.left;
    const ly = e.clientY - r.top;
    const t = c.chart.timeScale().coordinateToTime(lx);
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
  });

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
