"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useChartStore } from "@/store/chartStore";
import type { Drawing, Point, DrawingTool } from "@/types";
import { uid } from "@/utils/id";
import { renderDrawing, type Projector } from "./drawing/drawingRenderer";
import { hitTest } from "./drawing/drawingHitTest";
import {
  DrawingContextMenu,
  type DrawingMenuState,
} from "./DrawingContextMenu";

/** Tool → min points for creation. */
function minPoints(t: DrawingTool): number {
  switch (t) {
    case "horizontal":
    case "horizRay":
    case "vertical":
    case "crossLine":
    case "text":
    case "emoji":
    case "long":
    case "short":
      return 1;
    default:
      return 2;
  }
}

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

  const [pending, setPending] = useState<Point[] | null>(null);
  const [ctxMenu, setCtxMenu] = useState<DrawingMenuState | null>(null);

  const dragRef = useRef<{
    id: string;
    target: "p1" | "p2" | "body";
    startTime: number;
    startPrice: number;
    orig: Point[];
  } | null>(null);

  // Stable ref to avoid stale closures in native listeners.
  const stateRef = useRef({
    drawings: [] as Drawing[],
    activeTool: "cursor" as DrawingTool,
    pending: null as Point[] | null,
    drawColor: "#2962ff",
    drawingsLocked: false,
  });
  stateRef.current = {
    drawings,
    activeTool,
    pending,
    drawColor,
    drawingsLocked,
  };

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

    const s = stateRef.current;
    const visible = drawingsHidden ? [] : drawings;
    const projector: Projector = {
      toX,
      toY,
      width: rect.width,
      height: rect.height,
    };

    const pr = s.pending;
    const all = pr
      ? [
          ...visible,
          {
            id: "__pending",
            tool: s.activeTool,
            color: s.drawColor,
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
  }, [toX, toY, drawings, drawingsHidden, selectedDrawingId]);

  useEffect(() => {
    draw();
  }, [draw, ctx?.version]);

  // ---- Interaction architecture ----
  //
  // Chart interaction (zoom / pan / pinch) must ALWAYS work.
  // Drawing interaction only intercepts events when actively creating
  // or manipulating a drawing.
  //
  // Strategy:
  //   Canvas   → pointerEvents:none  (rendering only, never blocks chart)
  //   Document → conditional pointer listeners
  //     - Drawing mode:   registered → intercept all pointer events
  //     - Cursor + drag:  registered during drag via setPointerCapture
  //     - Otherwise:      NOT registered → chart receives all events
  //
  // This avoids z-index fights, event forwarding hacks, and DOM traversal.

  useEffect(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;

    // Only register document listeners when in drawing mode.
    // In cursor mode, listeners are added on-demand by the drag flow.
    if (s.activeTool === "cursor") return;

    // ---- Drawing mode: intercept all pointer events ----
    const handleDown = (e: PointerEvent) => {
      // Only handle events over our chart area.
      if (!canvas || !isOverCanvas(e, canvas)) return;

      const p = fromEvent(e);
      if (!p || !ctxRef.current) return;

      e.preventDefault();
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);

      const needed = minPoints(s.activeTool);

      if (s.activeTool === "text") {
        const text = window.prompt("Text:") || "";
        if (text)
          addDrawing({
            id: uid("dw"),
            tool: "text",
            color: s.drawColor,
            lineWidth: 1.5,
            points: [p],
            text,
          });
        else setActiveTool("cursor");
        return;
      }

      if (needed === 1) {
        addDrawing({
          id: uid("dw"),
          tool: s.activeTool,
          color: s.drawColor,
          lineWidth: 1.5,
          points: [p],
        });
        return;
      }

      if (!s.pending) {
        setPending([p]);
      } else {
        addDrawing({
          id: uid("dw"),
          tool: s.activeTool,
          color: s.drawColor,
          lineWidth: 1.5,
          points: [s.pending[0], p],
        });
        setPending(null);
      }
    };

    const handleMove = (e: PointerEvent) => {
      if (!canvas || !isOverCanvas(e, canvas)) return;
      const cur = stateRef.current;
      if (!cur.pending) return;
      const p = fromEvent(e);
      if (!p) return;
      setPending([cur.pending[0], p]);
    };

    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("pointermove", handleMove, true);

    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointermove", handleMove, true);
    };
    // Re-run when activeTool changes (entering/exiting drawing mode).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // ---- Cursor mode: drawing selection + drag via document listener ----
  // This effect runs once and stays active. In cursor mode, we listen for
  // pointerdown on the document. If a drawing is hit, we capture and handle drag.
  // If not, we do nothing → chart receives the event normally.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (e: PointerEvent) => {
      const s = stateRef.current;
      // Only handle cursor mode. Drawing mode is handled by the effect above.
      if (s.activeTool !== "cursor") return;
      if (!canvas || !isOverCanvas(e, canvas)) return;

      const p = fromEvent(e);
      if (!p || !ctxRef.current) return;

      const hit = hitTest(s.drawings, p, toX, toY);
      selectDrawing(hit?.drawing.id ?? null);

      if (hit && !s.drawingsLocked) {
        dragRef.current = {
          id: hit.drawing.id,
          target: hit.target,
          startTime: p.time,
          startPrice: p.price,
          orig: [...hit.drawing.points.map((pt) => ({ ...pt }))],
        };
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
      }
      // No hit → do nothing. Event reaches the chart → pan works.
    };

    const handleMove = (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.activeTool !== "cursor") return;

      const drag = dragRef.current;
      if (!drag) return;

      const p = fromEvent(e);
      if (!p) return;

      const next = drag.orig.map((pt) => ({ ...pt }));
      if (drag.target === "p1") {
        next[0] = { time: p.time, price: p.price };
      } else if (drag.target === "p2" && next.length > 1) {
        next[1] = { time: p.time, price: p.price };
      } else {
        const dt = p.time - drag.startTime;
        const dp = p.price - drag.startPrice;
        for (let i = 0; i < next.length; i++) {
          next[i] = {
            time: drag.orig[i].time + dt,
            price: drag.orig[i].price + dp,
          };
        }
      }
      updateDrawing(drag.id, { points: next });
    };

    const handleUp = () => {
      dragRef.current = null;
    };

    const handleCtx = (e: MouseEvent) => {
      const s = stateRef.current;
      if (!canvas || !isOverCanvas(e, canvas)) return;
      if (s.pending) {
        e.preventDefault();
        setPending(null);
        return;
      }
      const p = fromEvent(e as unknown as PointerEvent);
      if (!p) return;
      const hit = hitTest(s.drawings, p, toX, toY);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ id: hit.drawing.id, x: e.clientX, y: e.clientY });
      }
    };

    // Use capture phase so we see events before the chart does.
    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerup", handleUp, true);
    document.addEventListener("pointerleave", handleUp, true);
    canvas.addEventListener("contextmenu", handleCtx);

    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointerleave", handleUp, true);
      canvas.removeEventListener("contextmenu", handleCtx);
    };
    // Run once on mount. All state is accessed via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- keyboard ----
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
      if (e.key === "d" && (e.ctrlKey || e.metaKey) && selectedDrawingId) {
        e.preventDefault();
        duplicateDrawing(selectedDrawingId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDrawingId, removeDrawing, setActiveTool, duplicateDrawing]);

  const drawingMode = activeTool !== "cursor";
  let cursorStyle = "default";
  if (drawingMode) cursorStyle = "crosshair";
  if (dragRef.current) cursorStyle = "move";

  return (
    <>
      {/* Canvas: rendering only. pointerEvents:none always.
          Chart zoom/pan/pinch always work through the LWC chart div.
          Drawing interaction is handled by document-level listeners. */}
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

/** Check whether a pointer event is over the chart canvas area. */
function isOverCanvas(
  e: PointerEvent | MouseEvent,
  canvas: HTMLCanvasElement,
): boolean {
  const rect = canvas.getBoundingClientRect();
  return (
    e.clientX >= rect.left &&
    e.clientX <= rect.right &&
    e.clientY >= rect.top &&
    e.clientY <= rect.bottom
  );
}
