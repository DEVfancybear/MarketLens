"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import type { Drawing, Point, DrawingTool } from "@/types";
import { uid } from "@/utils/id";
import { hitTest, type HitResult } from "../drawingHitTest";
import type {
  DrawingContextMenu,
  DrawingMenuState,
} from "../../DrawingContextMenu";

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
// PanningChart is NOT a state — it's the Idle state where events pass
// through to the chart. We don't intercept panning at all.
// ============================================================================

export type InteractionState =
  | "Idle"
  | "Drawing"
  | "MovingDrawing"
  | "ResizingHandle";

export interface Machine {
  state: InteractionState;
  anchors: Point[];
  drawingTool: DrawingTool | null;
  drawingId: string | null;
  dragTarget: "p1" | "p2" | "body" | null;
  dragStart: Point | null;
  dragOrig: Point[] | null;
}

export const INITIAL_MACHINE: Machine = {
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

// ---- Options passed into the controller ----

export interface PointerControllerOpts {
  /** Ref to the rendering canvas (for coordinate conversion + pointer capture). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Convert pixel → chart (time, price). */
  fromEvent: (e: PointerEvent) => Point | null;
  /** Convert time → pixel x. */
  toX: (time: number) => number | null;
  /** Convert price → pixel y. */
  toY: (price: number) => number | null;
  /** Latest state snapshot (avoids stale closures in native listeners). */
  getState: () => {
    drawings: Drawing[];
    activeTool: DrawingTool;
    drawColor: string;
    drawingsLocked: boolean;
    ctxReady: boolean;
  };
  // ---- Store actions (stable zustand functions) ----
  addDrawing: (d: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  selectDrawing: (id: string | null) => void;
  setActiveTool: (t: DrawingTool) => void;
  /** Called when the controller modifies state that needs a redraw. */
  scheduleRedraw: () => void;
}

// ---- Return type ----

export interface PointerController {
  machine: Machine;
  /** Derived: current anchors when in Drawing state (for preview render). */
  pending: Point[] | null;
  /** Cursor CSS value. */
  cursorStyle: string;
  /** Context menu state. */
  ctxMenu: DrawingMenuState | null;
  setCtxMenu: (m: DrawingMenuState | null) => void;
  /** Transition to a new state (partial merge). */
  transition: (next: Partial<Machine>) => void;
  /** Reset to Idle. */
  reset: () => void;
  /** Stale-closure-safe ref to current machine. */
  machineRef: React.RefObject<Machine | null>;
}

// ---- Hook ----

export function usePointerController(
  opts: PointerControllerOpts,
): PointerController {
  const {
    canvasRef,
    fromEvent,
    toX,
    toY,
    getState,
    addDrawing,
    updateDrawing,
    selectDrawing,
    setActiveTool,
    scheduleRedraw,
  } = opts;

  const [machine, setMachine] = useState<Machine>(INITIAL_MACHINE);
  const [ctxMenu, setCtxMenu] = useState<DrawingMenuState | null>(null);

  const machineRef = useRef<Machine>(machine);
  machineRef.current = machine;

  const scheduleRedrawRef = useRef(scheduleRedraw);
  scheduleRedrawRef.current = scheduleRedraw;

  const pending: Point[] | null =
    machine.state === "Drawing" && machine.anchors.length > 0
      ? machine.anchors
      : null;

  const transition = useCallback((next: Partial<Machine>) => {
    setMachine((prev) => ({ ...prev, ...next }));
    scheduleRedrawRef.current();
  }, []);

  const reset = useCallback(() => {
    setMachine(INITIAL_MACHINE);
    scheduleRedrawRef.current();
  }, []);

  // ---- Drawing mode: document-level listener ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = getState();
    if (s.activeTool === "cursor") return;

    const handleDown = (e: PointerEvent) => {
      if (!canvas || !isOverCanvas(e, canvas)) return;
      const m = machineRef.current;
      if (m.state !== "Idle" && m.state !== "Drawing") return;

      const p = fromEvent(e);
      if (!p || !getState().ctxReady) return;

      e.preventDefault();
      e.stopPropagation();
      canvas.setPointerCapture(e.pointerId);

      const cur = getState();
      const needed = minPoints(cur.activeTool);

      if (cur.activeTool === "text") {
        const text = window.prompt("Text:") || "";
        if (text) {
          addDrawing({
            id: uid("dw"),
            tool: "text",
            color: cur.drawColor,
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
        addDrawing({
          id: uid("dw"),
          tool: cur.activeTool,
          color: cur.drawColor,
          lineWidth: 1.5,
          points: [p],
        });
        return;
      }

      // Two-click tools.
      if (m.state === "Drawing") {
        addDrawing({
          id: uid("dw"),
          tool: cur.activeTool,
          color: cur.drawColor,
          lineWidth: 1.5,
          points: [m.anchors[0], p],
        });
        reset();
      } else {
        transition({
          state: "Drawing",
          anchors: [p],
          drawingTool: cur.activeTool,
        });
      }
    };

    const handleMove = (e: PointerEvent) => {
      if (!canvas || !isOverCanvas(e, canvas)) return;
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
    // Re-run when activeTool changes (the getState() call at top checks it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getState().activeTool]);

  // ---- Cursor mode: drawing selection + drag ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (e: PointerEvent) => {
      const cur = getState();
      if (cur.activeTool !== "cursor") return;
      if (!canvas || !isOverCanvas(e, canvas)) return;

      const p = fromEvent(e);
      if (!p || !cur.ctxReady) return;

      const hit = hitTest(cur.drawings, p, toX, toY);
      selectDrawing(hit?.drawing.id ?? null);

      if (hit && !cur.drawingsLocked) {
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);

        const isHandle = hit.target === "p1" || hit.target === "p2";
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
      const cur = getState();
      if (!canvas || !isOverCanvas(e, canvas)) return;

      if (m.state === "Drawing") {
        e.preventDefault();
        reset();
        return;
      }

      const p = fromEvent(e as unknown as PointerEvent);
      if (!p) return;
      const hit = hitTest(cur.drawings, p, toX, toY);
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
    // Run once on mount. getState() + machineRef provide fresh data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Cursor style ----
  const drawingMode = getState().activeTool !== "cursor";
  let cursorStyle = "default";
  if (drawingMode) cursorStyle = "crosshair";
  if (machine.state === "MovingDrawing" || machine.state === "ResizingHandle") {
    cursorStyle = "move";
  }

  return {
    machine,
    pending,
    cursorStyle,
    ctxMenu,
    setCtxMenu,
    transition,
    reset,
    machineRef,
  };
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
