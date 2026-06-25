"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useChartStore } from "@/store/chartStore";
import type { Drawing, Point } from "@/types";
import { renderDrawing, type Projector } from "./drawing/drawingRenderer";
import { DrawingContextMenu } from "./DrawingContextMenu";
import { usePointerController } from "./drawing/interaction/PointerController";

export function DrawingLayer() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawings = useChartStore((s) => s.drawings);
  const activeTool = useChartStore((s) => s.activeTool);
  const drawColor = useChartStore((s) => s.drawColor);
  const selectedDrawingId = useChartStore((s) => s.selectedDrawingId);
  const drawingsLocked = useChartStore((s) => s.drawingsLocked);
  const drawingsHidden = useChartStore((s) => s.drawingsHidden);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const updateDrawing = useChartStore((s) => s.updateDrawing);
  const selectDrawing = useChartStore((s) => s.selectDrawing);
  const removeDrawing = useChartStore((s) => s.removeDrawing);
  const duplicateDrawing = useChartStore((s) => s.duplicateDrawing);
  const setActiveTool = useChartStore((s) => s.setActiveTool);

  // Stable ref to avoid stale ctx in closures.
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

  /** Convert a PointerEvent to chart (time, price) coordinates. */
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

  // Stable state snapshot for PointerController's native listeners.
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

  // ---- Pointer interaction (extracted) ----
  const { cursorStyle, ctxMenu, setCtxMenu, reset, machineRef } =
    usePointerController({
      canvasRef,
      fromEvent,
      toX,
      toY,
      getState: () => stateRef.current,
      addDrawing,
      updateDrawing,
      selectDrawing,
      setActiveTool,
    });

  // ---- rendering ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const c = ctxRef.current;
    if (!canvas || !c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (
      canvas.width !== rect.width * dpr ||
      canvas.height !== rect.height * dpr
    ) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, rect.width, rect.height);

    const visible = drawingsHidden ? [] : drawings;
    const projector: Projector = {
      toX,
      toY,
      width: rect.width,
      height: rect.height,
    };

    const m = machineRef.current;
    const pr =
      m?.state === "Drawing" && m.anchors.length > 0 ? m.anchors : null;
    const tool = m?.state === "Drawing" ? (m.drawingTool ?? activeTool) : null;
    const all =
      pr && tool
        ? [
            ...visible,
            {
              id: "__pending",
              tool,
              color: drawColor,
              lineWidth: 1.5,
              points: pr,
              visible: true,
            } as Drawing,
          ]
        : visible;

    const sorted = [...all].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    for (const d of sorted) {
      if (d.visible === false) continue;
      const selected = d.id === selectedDrawingId;
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.6 : 1);
      renderDrawing(g, d, projector, selected);
    }
  }, [
    toX,
    toY,
    drawings,
    drawingsHidden,
    selectedDrawingId,
    activeTool,
    drawColor,
    machineRef,
  ]);

  useEffect(() => {
    draw();
  }, [draw, ctx?.version]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId) {
        removeDrawing(selectedDrawingId);
      }
      if (e.key === "Escape") {
        reset();
        setActiveTool("cursor");
      }
      if (e.key === "d" && (e.ctrlKey || e.metaKey) && selectedDrawingId) {
        e.preventDefault();
        duplicateDrawing(selectedDrawingId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedDrawingId,
    removeDrawing,
    setActiveTool,
    duplicateDrawing,
    reset,
  ]);

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
