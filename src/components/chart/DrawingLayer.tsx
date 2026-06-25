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
  // Diagnostic: log when chart context becomes available.
  useEffect(() => {
    if (ctx)
      console.log(
        "[DrawingLayer] chart context available, candles:",
        ctx.candles.length,
      );
  }, [ctx]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Diagnostic: log when canvas mounts.
  useEffect(() => {
    if (canvasRef.current) {
      const r = canvasRef.current.getBoundingClientRect();
      console.log("[DrawingLayer] canvas mounted", {
        w: r.width,
        h: r.height,
        offsetH: canvasRef.current.offsetHeight,
      });
    }
  }, []);

  const drawings = useChartStore((s) => s.drawings);
  const activeTool = useChartStore((s) => s.activeTool);

  // Diagnostic: log every activeTool change.
  useEffect(() => {
    console.log("[DrawingLayer] activeTool changed to:", activeTool);
  }, [activeTool]);
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
    startTime: number;
    startPrice: number;
    orig: Point[];
  } | null>(null);

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
      // Brief trace (only on pointerDown, not every move).
      console.log("[DrawingLayer] fromEvent", {
        x: Math.round(x),
        y: Math.round(y),
        time,
        price: price?.toFixed(4),
      });
      if (time == null || price == null) return null;
      return { time: time as number, price };
    },
    [ctx],
  );

  // ---- rendering ----
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

    const visible = drawingsHidden ? [] : drawings;
    const projector: Projector = {
      toX,
      toY,
      width: rect.width,
      height: rect.height,
    };

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

  useEffect(() => {
    draw();
  }, [draw, ctx?.version]);

  // ---- interaction: pointer ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (process.env.NODE_ENV === "development") {
      console.log(
        "[DrawingLayer] pointerDown",
        "tool:",
        activeTool,
        "ctx:",
        !!ctx,
        "target:",
        (e.target as HTMLElement)?.tagName,
      );
    }
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

    // ---- tool creation ----
    const needed = minPoints(activeTool);
    console.log("[DrawingLayer] tool creation", {
      tool: activeTool,
      needed,
      price: p.price.toFixed(4),
      pending: !!pending,
    });

    // Text needs a prompt before placing.
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

    // Single-click tools: commit immediately, tool stays active (TradingView behavior).
    if (needed === 1) {
      addDrawing({
        id: uid("dw"),
        tool: activeTool,
        color: drawColor,
        lineWidth: 1.5,
        points: [p],
      });
      // Tool remains active — user can place more of the same tool.
      return;
    }

    // Two-click tools.
    if (!pending) {
      console.log("[DrawingLayer] start preview, point 1 placed");
      setPending([p]);
    } else {
      console.log("[DrawingLayer] complete drawing, point 2 placed");
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
    if (pending) {
      setPending([pending[0], p]);
      return;
    }
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

  // Right-click context menu on drawings, or cancel pending creation.
  const onCtxMenu = (e: React.MouseEvent) => {
    // If a drawing is pending, right-click cancels it (TradingView behavior).
    if (pending) {
      e.preventDefault();
      setPending(null);
      return;
    }
    const p = fromEvent(e as unknown as React.PointerEvent);
    if (!p) return;
    const hit = hitTest(drawings, p, toX, toY);
    if (hit) {
      e.preventDefault();
      setCtxMenu({ id: hit.id, x: e.clientX, y: e.clientY });
    }
  };

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
      // Ctrl+D → duplicate selected drawing.
      if (e.key === "d" && (e.ctrlKey || e.metaKey) && selectedDrawingId) {
        e.preventDefault();
        duplicateDrawing(selectedDrawingId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDrawingId, removeDrawing, setActiveTool, duplicateDrawing]);

  // Canvas must accept pointer events when:
  // - Any drawing tool is active (including cursor with existing drawings)
  // - Pending creation preview is showing
  // Cursor: crosshair for drawing tools, move cursor when dragging,
  // default (pointer) for cursor mode.
  let cursorStyle = "default";
  if (activeTool !== "cursor") cursorStyle = "crosshair";
  if (dragRef.current) cursorStyle = "move";
  const hasDrawings = drawings.length > 0;
  // Always allow pointer events when a non-cursor tool is active, so
  // the first click works even with zero prior drawings.
  const pointerEvents =
    activeTool !== "cursor" || hasDrawings || pending !== null
      ? "auto"
      : "none";

  console.log("[DrawingLayer] render", {
    tool: activeTool,
    pointerEvents,
    cursorStyle,
    hasDrawings,
    canvasW: canvasRef.current?.offsetWidth,
    canvasH: canvasRef.current?.offsetHeight,
  });

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={onCtxMenu}
        className="absolute inset-0 h-full w-full"
        style={{
          cursor: cursorStyle,
          pointerEvents,
        }}
      />
      {ctxMenu && (
        <DrawingContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      )}
    </>
  );
}
