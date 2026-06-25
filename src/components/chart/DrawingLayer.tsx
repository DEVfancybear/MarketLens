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

// ============================================================================
// Interaction State Machine
// ============================================================================
//
// States:
//   Idle            — nothing happening; chart handles zoom/pan/pinch
//   Drawing         — creating a drawing (1st point placed, preview visible)
//   MovingDrawing   — dragging an entire drawing (body hit)
//   ResizingHandle  — dragging a single anchor point (p1 or p2 hit)
//
// PanningChart is NOT a DrawingLayer state — it's the Idle state where
// events pass through to the chart. We don't intercept panning at all.
//
// Transitions:
//   Idle -[pointerdown, drawing mode, 2-click tool]→ Drawing
//   Idle -[pointerdown, drawing mode, 1-click tool]→ Idle (committed)
//   Idle -[pointerdown, cursor mode, hit body]→ MovingDrawing
//   Idle -[pointerdown, cursor mode, hit p1/p2]→ ResizingHandle
//   Idle -[pointerdown, cursor mode, no hit]→ Idle (chart pans)
//   Drawing -[pointermove]→ Drawing (update preview)
//   Drawing -[pointerdown, 2nd click]→ Idle (completed)
//   Drawing -[Escape / right-click]→ Idle (cancelled)
//   MovingDrawing -[pointermove]→ MovingDrawing (update position)
//   MovingDrawing -[pointerup]→ Idle
//   ResizingHandle -[pointermove]→ ResizingHandle (update handle)
//   ResizingHandle -[pointerup]→ Idle
// ============================================================================

type InteractionState = "Idle" | "Drawing" | "MovingDrawing" | "ResizingHandle";

interface Machine {
  state: InteractionState;
  /** Anchor points placed so far during Drawing state. */
  anchors: Point[];
  /** Active tool during Drawing state. */
  drawingTool: DrawingTool | null;
  /** Drawing being dragged (Id = store drawing id). */
  drawingId: string | null;
  /** Which part of the drawing is being dragged. */
  dragTarget: "p1" | "p2" | "body" | null;
  /** Pointer position at drag start (for body delta translation). */
  dragStart: Point | null;
  /** Original drawing points at drag start. */
  dragOrig: Point[] | null;
}

const INITIAL: Machine = {
  state: "Idle",
  anchors: [],
  drawingTool: null,
  drawingId: null,
  dragTarget: null,
  dragStart: null,
  dragOrig: null,
};

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

  const [machine, setMachine] = useState<Machine>(INITIAL);
  const [ctxMenu, setCtxMenu] = useState<DrawingMenuState | null>(null);

  // For preview rendering: the current Drawing-state anchors.
  const pending =
    machine.state === "Drawing" && machine.anchors.length > 0
      ? machine.anchors
      : null;

  // Stable refs for native event handlers (no stale closures).
  const machineRef = useRef(machine);
  machineRef.current = machine;

  const stateRef = useRef({
    drawings: [] as Drawing[],
    activeTool: "cursor" as DrawingTool,
    drawColor: "#2962ff",
    drawingsLocked: false,
  });
  stateRef.current = { drawings, activeTool, drawColor, drawingsLocked };

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

  // ---- State machine transitions ----
  const transition = useCallback((next: Partial<Machine>) => {
    setMachine((prev) => ({ ...prev, ...next }));
  }, []);

  const reset = useCallback(() => setMachine(INITIAL), []);

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
    const pr = m.state === "Drawing" && m.anchors.length > 0 ? m.anchors : null;
    const tool = m.state === "Drawing" ? (m.drawingTool ?? activeTool) : null;
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
  ]);

  useEffect(() => {
    draw();
  }, [draw, ctx?.version]);

  // ---- Drawing mode: document-level listener ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Only active in drawing mode.
    if (activeTool === "cursor") return;

    const handleDown = (e: PointerEvent) => {
      if (!isOverCanvas(e, canvas)) return;
      if (
        machineRef.current.state !== "Idle" &&
        machineRef.current.state !== "Drawing"
      )
        return;

      const p = fromEvent(e);
      if (!p || !ctxRef.current) return;

      e.preventDefault();
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);

      const needed = minPoints(activeTool);

      if (activeTool === "text") {
        const text = window.prompt("Text:") || "";
        if (text) {
          const s = stateRef.current;
          addDrawing({
            id: uid("dw"),
            tool: "text",
            color: s.drawColor,
            lineWidth: 1.5,
            points: [p],
            text,
          });
        } else {
          setActiveTool("cursor");
        }
        return;
      }

      if (needed === 1) {
        const s = stateRef.current;
        addDrawing({
          id: uid("dw"),
          tool: activeTool,
          color: s.drawColor,
          lineWidth: 1.5,
          points: [p],
        });
        return;
      }

      // Two-click tools.
      const m = machineRef.current;
      if (m.state === "Drawing") {
        // Second click: complete the drawing.
        addDrawing({
          id: uid("dw"),
          tool: activeTool,
          color: stateRef.current.drawColor,
          lineWidth: 1.5,
          points: [m.anchors[0], p],
        });
        reset();
      } else {
        // First click: enter Drawing state.
        transition({ state: "Drawing", anchors: [p], drawingTool: activeTool });
      }
    };

    const handleMove = (e: PointerEvent) => {
      if (!isOverCanvas(e, canvas)) return;
      const m = machineRef.current;
      if (m.state !== "Drawing") return;
      const p = fromEvent(e);
      if (!p) return;
      transition({ anchors: [m.anchors[0], p] });
    };

    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("pointermove", handleMove, true);

    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointermove", handleMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool]);

  // ---- Cursor mode: drawing selection + drag ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (e: PointerEvent) => {
      const s = stateRef.current;
      if (s.activeTool !== "cursor") return;
      if (!isOverCanvas(e, canvas)) return;

      const p = fromEvent(e);
      if (!p || !ctxRef.current) return;

      const hit = hitTest(s.drawings, p, toX, toY);
      selectDrawing(hit?.drawing.id ?? null);

      if (hit && !s.drawingsLocked) {
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);

        const isHandle = hit.target === "p1" || hit.target === "p2";
        // Normalize: segment/label hits drag like body.
        const dragTarget: Machine["dragTarget"] =
          hit.target === "p1" || hit.target === "p2" ? hit.target : "body";
        transition({
          state: isHandle ? "ResizingHandle" : "MovingDrawing",
          drawingId: hit.drawing.id,
          dragTarget,
          dragStart: p,
          dragOrig: [...hit.drawing.points.map((pt) => ({ ...pt }))],
        });
      }
    };

    const handleMove = (e: PointerEvent) => {
      const m = machineRef.current;
      if (m.state !== "MovingDrawing" && m.state !== "ResizingHandle") return;
      if (!m.dragOrig || !m.dragStart) return;

      const p = fromEvent(e);
      if (!p) return;

      const next = m.dragOrig.map((pt) => ({ ...pt }));

      if (m.dragTarget === "p1") {
        next[0] = { time: p.time, price: p.price };
      } else if (m.dragTarget === "p2" && next.length > 1) {
        next[1] = { time: p.time, price: p.price };
      } else {
        const dt = p.time - m.dragStart.time;
        const dp = p.price - m.dragStart.price;
        for (let i = 0; i < next.length; i++) {
          next[i] = {
            time: m.dragOrig[i].time + dt,
            price: m.dragOrig[i].price + dp,
          };
        }
      }

      updateDrawing(m.drawingId!, { points: next });
    };

    const handleUp = () => {
      const m = machineRef.current;
      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        reset();
      }
    };

    const handleCtx = (e: MouseEvent) => {
      const m = machineRef.current;
      const s = stateRef.current;
      if (!isOverCanvas(e, canvas)) return;

      if (m.state === "Drawing") {
        e.preventDefault();
        reset();
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

  const drawingMode = activeTool !== "cursor";
  const activeState = machine.state;
  let cursorStyle = "default";
  if (drawingMode) cursorStyle = "crosshair";
  if (activeState === "MovingDrawing" || activeState === "ResizingHandle")
    cursorStyle = "move";

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
