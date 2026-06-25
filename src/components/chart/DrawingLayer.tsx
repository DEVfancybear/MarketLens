"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UTCTimestamp } from "lightweight-charts";
import { useChartCtx } from "./ChartContext";
import { useChartStore } from "@/store/chartStore";
import type { Drawing, Point, DrawingTool } from "@/types";
import { uid } from "@/utils/id";
import { renderDrawing, type Projector } from "./drawing/drawingRenderer";
import { hitTest, type HitResult } from "./drawing/drawingHitTest";
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

  // Stable refs for the native event handlers (avoids stale-closure issues).
  const stateRef = useRef({
    drawings: [] as Drawing[],
    activeTool: "cursor" as DrawingTool,
    pending: null as Point[] | null,
    drag: null as typeof dragRef.current,
    drawColor: "#2962ff",
    drawingsLocked: false,
    drawingsHidden: false,
    selectedDrawingId: null as string | null,
  });

  // Keep stateRef in sync every render (safe — used only inside event callbacks).
  stateRef.current = {
    drawings,
    activeTool,
    pending,
    drag: dragRef.current,
    drawColor,
    drawingsLocked,
    drawingsHidden,
    selectedDrawingId,
  };

  // Stable ref to avoid effect re-registration on ctx.version bumps.
  // ctx.chart and ctx.candleSeries are stable; only version/candles change.
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
    if (!c || !canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
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

    const visible = stateRef.current.drawingsHidden
      ? []
      : stateRef.current.drawings;
    const projector: Projector = {
      toX,
      toY,
      width: rect.width,
      height: rect.height,
    };

    const pr = stateRef.current.pending;
    const all = pr
      ? [
          ...visible,
          {
            id: "__pending",
            tool: stateRef.current.activeTool,
            color: stateRef.current.drawColor,
            lineWidth: 1.5,
            points: pr,
            visible: true,
          } as Drawing,
        ]
      : visible;

    const sorted = [...all].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));

    for (const d of sorted) {
      if (d.visible === false) continue;
      const selected = d.id === stateRef.current.selectedDrawingId;
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = (d.lineWidth || 1.5) * (selected ? 1.6 : 1);
      renderDrawing(g, d, projector, selected);
    }
  }, [toX, toY]);

  useEffect(() => {
    draw();
  }, [draw, ctx?.version]);

  // ---- native pointer event handlers ----
  // These are attached to the canvas with addEventListener so they fire
  // regardless of pointer-events CSS. The canvas itself stays pointer-events:none
  // in cursor mode, so chart zoom/pan work. In drawing mode, pointer-events:auto
  // is set directly on the canvas element via style.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (e: PointerEvent) => {
      const s = stateRef.current;
      const p = fromEvent(e);
      if (!p || !ctx) return;

      if (s.activeTool === "cursor") {
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
          canvas.setPointerCapture(e.pointerId);
          e.stopPropagation();
          e.preventDefault();
        }
        // If no hit, the event propagates naturally to the chart → pan works.
        return;
      }

      // ---- drawing mode ----
      e.stopPropagation();
      e.preventDefault();
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

      // Two-click tools.
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
      const s = stateRef.current;
      const p = fromEvent(e);
      if (!p) return;

      if (s.activeTool !== "cursor" && s.pending) {
        setPending([s.pending[0], p]);
        return;
      }

      const drag = dragRef.current;
      if (drag) {
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
        stateRef.current.drag = dragRef.current; // keep in sync
      }
      // In cursor mode with no drag: event propagates naturally to chart → pan works.
    };

    const handleUp = () => {
      dragRef.current = null;
      stateRef.current.drag = null;
    };

    const handleCtx = (e: MouseEvent) => {
      const s = stateRef.current;
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

    canvas.addEventListener("pointerdown", handleDown);
    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerup", handleUp);
    canvas.addEventListener("pointerleave", handleUp);
    canvas.addEventListener("contextmenu", handleCtx);

    return () => {
      canvas.removeEventListener("pointerdown", handleDown);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerup", handleUp);
      canvas.removeEventListener("pointerleave", handleUp);
      canvas.removeEventListener("contextmenu", handleCtx);
    };
    // All closures (fromEvent, toX, toY, hitTest, store actions) are stable
    // via ctxRef + empty-dep useCallbacks. Run once on mount.
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

  const hasDrawings = drawings.length > 0;
  const drawingMode = activeTool !== "cursor";

  // Cursor style for the canvas.
  let cursorStyle = "default";
  if (drawingMode) cursorStyle = "crosshair";
  if (dragRef.current) cursorStyle = "move";

  // Canvas pointer-events strategy:
  //   Drawing mode → "auto" (we need to intercept everything for creation)
  //   Cursor mode  → "none" (events pass through to chart; native
  //                   addEventListener handles drawing selection/drag)
  // The native pointerdown listener (above) fires regardless of CSS,
  // so drawing selection works even with pointer-events:none.
  const pointerEvents = drawingMode || pending !== null ? "auto" : "none";

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{
          cursor: cursorStyle,
          pointerEvents,
          zIndex: 5,
        }}
      />
      {ctxMenu && (
        <DrawingContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </>
  );
}
