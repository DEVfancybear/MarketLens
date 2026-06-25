"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useChartStore } from "@/store/chartStore";
import { FIB_LEVELS, type Drawing, type Point } from "@/types";
import { uid } from "@/utils/id";
import { renderDrawing, type Projector } from "./drawing/drawingRenderer";
import { hitTest } from "./drawing/drawingHitTest";

/**
 * Transparent canvas laid over the price chart that renders user drawings and
 * handles their creation / selection / movement. All geometry is stored in
 * (time, price) space and projected to pixels each frame, so drawings stay
 * pinned to the data through pan & zoom.
 *
 * Rendering delegates to the standalone `drawingRenderer.ts` (17-tool support).
 * Hit-testing delegates to the standalone `drawingHitTest.ts`.
 * Interaction (pointer events, drag, creation) is handled here.
 */
export function DrawingLayer() {
  const ctx = useChartCtx();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Atomic selectors — this component does NOT subscribe to `candles`,
  // so realtime ticks never re-render the canvas. Repaint is driven by
  // `ctx.version` (pan/zoom/resize) and by drawing state changes.
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
  const setActiveTool = useChartStore((s) => s.setActiveTool);

  // In-progress drawing (first point placed, awaiting subsequent points).
  const [pending, setPending] = useState<Point[] | null>(null);
  const dragRef = useRef<{
    id: string;
    startTime: number;
    startPrice: number;
    orig: Point[];
  } | null>(null);

  // ---- coordinate helpers ----
  const toX = useCallback(
    (time: number) =>
      ctx?.chart.timeScale().timeToCoordinate(time as UTCTimestamp) ?? null,
    [ctx],
  );
  const toY = useCallback(
    (price: number) => ctx?.candleSeries.priceToCoordinate(price) ?? null,
    [ctx],
  );
  const fromEvent = useCallback(
    (e: React.PointerEvent | PointerEvent): Point | null => {
      if (!ctx || !canvasRef.current) return null;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = ctx.chart.timeScale().coordinateToTime(x);
      const price = ctx.candleSeries.coordinateToPrice(y);
      if (time == null || price == null) return null;
      return { time: time as number, price };
    },
    [ctx],
  );

  const projRef = useRef<Projector>({
    toX: () => null,
    toY: () => null,
    width: 0,
    height: 0,
  });

  // ---- rendering (delegates to drawingRenderer.ts) ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ctx) return;
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

    // Resolve visible drawings (respect global hide toggle).
    const visible = drawingsHidden ? [] : drawings;

    // Build projector for this frame.
    const projector: Projector = {
      toX,
      toY,
      width: rect.width,
      height: rect.height,
    };
    projRef.current = projector;

    // Append pending preview as a virtual drawing.
    const all = pending
      ? [
          ...visible,
          {
            id: "__pending",
            tool: activeTool,
            color: drawColor,
            lineWidth: 1.5,
            points: pending,
            visible: true,
          } as Drawing,
        ]
      : visible;

    // Sort by zIndex so higher indices render on top.
    const sorted = [...all].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

    for (const d of sorted) {
      if (d.visible === false) continue;
      const selected = d.id === selectedDrawingId;
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.6 : 1);

      // ---- delegate to the canonical 17-tool renderer ----
      renderDrawing(g, d, projector, selected);
    }
  }, [
    ctx,
    drawings,
    pending,
    activeTool,
    drawColor,
    selectedDrawingId,
    drawingsHidden,
    toX,
    toY,
  ]);

  // Repaint whenever data, version (pan/zoom/resize) or drawings change.
  useEffect(() => {
    draw();
  }, [draw, ctx?.version]);

  // ---- interaction ----
  const onPointerDown = (e: React.PointerEvent) => {
    const p = fromEvent(e);
    if (!p || !ctx) return;

    if (activeTool === "cursor") {
      const hit = hitTest(drawings, p, toX, toY);
      selectDrawing(hit?.id ?? null);
      if (hit && !drawingsLocked) {
        dragRef.current = {
          id: hit.id,
          startTime: p.time,
          startPrice: p.price,
          orig: hit.points,
        };
        (e.target as Element).setPointerCapture(e.pointerId);
      }
      return;
    }

    // Single-click tools: horizontal, vertical, text.
    if (activeTool === "horizontal") {
      addDrawing({
        id: uid("dw"),
        tool: "horizontal",
        color: drawColor,
        lineWidth: 1.5,
        points: [p],
      });
      return;
    }
    if (activeTool === "vertical") {
      addDrawing({
        id: uid("dw"),
        tool: "vertical",
        color: drawColor,
        lineWidth: 1.5,
        points: [p],
      });
      return;
    }
    if (activeTool === "text") {
      const text = window.prompt("Text:") || "";
      if (text)
        addDrawing({
          id: uid("dw"),
          tool: "text",
          color: drawColor,
          lineWidth: 1.5,
          points: [p],
          text,
        });
      else setActiveTool("cursor");
      return;
    }

    // Two-click tools: trendline, rectangle, fib.
    if (!pending) {
      setPending([p]);
    } else {
      addDrawing({
        id: uid("dw"),
        tool: activeTool,
        color: drawColor,
        lineWidth: 1.5,
        points: [pending[0], p],
      });
      setPending(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = fromEvent(e);
    if (!p) return;

    // Live preview of pending second point.
    if (pending) {
      setPending([pending[0], p]);
      return;
    }
    // Dragging a selected drawing.
    const drag = dragRef.current;
    if (drag) {
      const dt = p.time - drag.startTime;
      const dp = p.price - drag.startPrice;
      updateDrawing(drag.id, {
        points: drag.orig.map((pt) => ({
          time: pt.time + dt,
          price: pt.price + dp,
        })),
      });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Keyboard: Delete / Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedDrawingId) {
        removeDrawing(selectedDrawingId);
      }
      if (e.key === "Escape") {
        setPending(null);
        setActiveTool("cursor");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDrawingId, removeDrawing, setActiveTool]);

  const interactive = activeTool !== "cursor" || pending !== null;

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="absolute inset-0 h-full w-full"
      style={{
        cursor: activeTool === "cursor" ? "default" : "crosshair",
        pointerEvents: interactive || drawings.length ? "auto" : "none",
      }}
    />
  );
}
