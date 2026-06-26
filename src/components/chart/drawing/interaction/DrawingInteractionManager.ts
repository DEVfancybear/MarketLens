"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import type { Drawing, Point, DrawingTool } from "@/types";
import { uid } from "@/utils/id";
import { hitTest, type HitResult } from "../hittest/HitTestEngine";
import { getTool, defaultMovePoints } from "../tools/ToolRegistry";
import type { DrawingMenuState } from "../../DrawingContextMenu";

// ============================================================================
// Interaction State Machine
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
  livePoints: Point[] | null;
}

export const INITIAL_MACHINE: Machine = {
  state: "Idle",
  anchors: [],
  drawingTool: null,
  drawingId: null,
  dragTarget: null,
  dragStart: null,
  dragOrig: null,
  livePoints: null,
};

function minPoints(t: DrawingTool): number {
  return getTool(t)?.minPoints ?? 2;
}

// ---- Options ----

export interface DrawingInteractionManagerOpts {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  fromEvent: (e: PointerEvent) => Point | null;
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  getState: () => {
    drawings: Drawing[];
    activeTool: DrawingTool;
    drawColor: string;
    drawingsLocked: boolean;
    ctxReady: boolean;
  };
  addDrawing: (d: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  selectDrawing: (id: string | null) => void;
  setActiveTool: (t: DrawingTool) => void;
  scheduleRedraw: () => void;
}

// ---- Return type ----

export interface DrawingInteractionHandle {
  machine: Machine;
  pending: Point[] | null;
  cursorStyle: string;
  ctxMenu: DrawingMenuState | null;
  setCtxMenu: (m: DrawingMenuState | null) => void;
  reset: () => void;
  machineRef: React.RefObject<Machine | null>;
  livePointsRef: React.RefObject<Point[] | null>;
  drawingIdRef: React.RefObject<string | null>;
  /** True when drawings have claimed the pointer (chart should yield). */
  isPointerClaimed: () => boolean;
}

// ---- Hook ----

export function useDrawingInteractionManager(
  opts: DrawingInteractionManagerOpts,
): DrawingInteractionHandle {
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

  const livePointsRef = useRef<Point[] | null>(null);
  const drawingIdRef = useRef<string | null>(null);

  const pointerClaimedRef = useRef(false);

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
    pointerClaimedRef.current = false;
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
      pointerClaimedRef.current = true;

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
          pointerClaimedRef.current = false;
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
        pointerClaimedRef.current = true;

        // Canonical drag target mapping — only three allowed values.
        const isHandle = hit.target === "p1" || hit.target === "p2";
        const dragTarget: Machine["dragTarget"] =
          hit.target === "p1" ? "p1" : hit.target === "p2" ? "p2" : "body";
        const orig: Point[] = [
          ...hit.drawing.points.map((pt: Point) => ({ ...pt })),
        ];
        drawingIdRef.current = hit.drawing.id;
        livePointsRef.current = orig;
        transition({
          state: isHandle ? "ResizingHandle" : "MovingDrawing",
          drawingId: hit.drawing.id,
          dragTarget,
          dragStart: p,
          dragOrig: orig,
          livePoints: orig,
        });
      }
    };

    const handleMove = (e: PointerEvent) => {
      const m = machineRef.current;
      if (m.state !== "MovingDrawing" && m.state !== "ResizingHandle") return;
      if (!m.dragOrig || !m.dragStart) return;

      const p = fromEvent(e);
      if (!p) return;

      const adapter = getTool(m.drawingTool ?? "trendline");
      const next = adapter
        ? adapter.movePoints(m.dragOrig, p, m.dragTarget ?? "body", m.dragStart)
        : defaultMovePoints(m.dragOrig, p, m.dragTarget ?? "body", m.dragStart);

      livePointsRef.current = next;
      scheduleRedrawRef.current();
    };

    const handleUp = () => {
      const m = machineRef.current;
      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        if (livePointsRef.current && drawingIdRef.current) {
          updateDrawing(drawingIdRef.current, {
            points: livePointsRef.current,
          });
        }
        livePointsRef.current = null;
        drawingIdRef.current = null;
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
    reset,
    machineRef,
    livePointsRef,
    drawingIdRef,
    isPointerClaimed: () => pointerClaimedRef.current,
  };
}

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
