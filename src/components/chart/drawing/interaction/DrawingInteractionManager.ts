"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import type { Drawing, Point, DrawingTool } from "@/types";
import { uid } from "@/utils/id";
import { hitTest, type HitResult } from "../hittest/HitTestEngine";
import {
  getTool,
  defaultMove,
  defaultMoveAnchor,
  defaultMovePoints,
} from "../tools/ToolRegistry";
import type { DrawingMenuState } from "../../DrawingContextMenu";
import type { Command } from "../history/CommandManager";
import {
  DeleteDrawingCommand,
  DuplicateDrawingCommand,
} from "../history/CommandManager";

// ============================================================================
// Types
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
  /** Which anchor index is being dragged (-1 = body). */
  dragAnchor: number;
  dragStart: Point | null;
  dragOrig: Point[] | null;
}

export const INITIAL_MACHINE: Machine = {
  state: "Idle",
  anchors: [],
  drawingTool: null,
  drawingId: null,
  dragAnchor: -1,
  dragStart: null,
  dragOrig: null,
};

function minPoints(t: DrawingTool): number {
  return getTool(t)?.minPoints ?? 2;
}

// ============================================================================
// Options
// ============================================================================

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
    selectedDrawingId: string | null;
  };
  addDrawing: (d: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;
  selectDrawing: (id: string | null) => void;
  setActiveTool: (t: DrawingTool) => void;
  scheduleRedraw: () => void;
  commitMove?: (id: string, newPoints: Point[], oldPoints: Point[]) => void;
  executeCommand?: (cmd: Command) => void;
  undo?: () => void;
  redo?: () => void;
  selectAll?: () => void;
  duplicateDrawing?: (id: string) => void;
}

// ============================================================================
// Return type
// ============================================================================

export interface DrawingInteractionHandle {
  machine: Machine;
  cursorStyle: string;
  ctxMenu: DrawingMenuState | null;
  setCtxMenu: (m: DrawingMenuState | null) => void;
  reset: () => void;
  machineRef: React.RefObject<Machine | null>;
  livePointsRef: React.RefObject<Point[] | null>;
  drawingIdRef: React.RefObject<string | null>;
  hoveredIdRef: React.RefObject<string | null>;
  isPointerClaimed: () => boolean;
}

// ============================================================================
// Hook
// ============================================================================

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
    removeDrawing,
    selectDrawing,
    setActiveTool,
    scheduleRedraw,
    commitMove,
    executeCommand,
    undo,
    redo,
    selectAll,
    duplicateDrawing,
  } = opts;

  const [machine, setMachine] = useState<Machine>(INITIAL_MACHINE);
  const [ctxMenu, setCtxMenu] = useState<DrawingMenuState | null>(null);

  const machineRef = useRef<Machine>(machine);
  machineRef.current = machine;

  const scheduleRedrawRef = useRef(scheduleRedraw);
  scheduleRedrawRef.current = scheduleRedraw;

  const livePointsRef = useRef<Point[] | null>(null);
  const drawingIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);

  const pointerClaimedRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);

  const transition = useCallback((next: Partial<Machine>) => {
    setMachine((prev) => ({ ...prev, ...next }));
    scheduleRedrawRef.current();
  }, []);

  const releaseCapture = useCallback(() => {
    const canvas = canvasRef.current;
    const pid = activePointerIdRef.current;
    if (canvas && pid != null) {
      try {
        canvas.releasePointerCapture(pid);
      } catch {
        /* ok */
      }
    }
    activePointerIdRef.current = null;
  }, [canvasRef]);

  const reset = useCallback(() => {
    setMachine(INITIAL_MACHINE);
    releaseCapture();
    pointerClaimedRef.current = false;
    scheduleRedrawRef.current();
  }, [releaseCapture]);

  // ================================================================
  // DRAWING MODE
  // ================================================================
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
      activePointerIdRef.current = e.pointerId;
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
          releaseCapture();
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

  // ================================================================
  // CURSOR MODE — polymorphic selection + drag + hover + context menu
  // ================================================================
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

      if (hit && !cur.drawingsLocked && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        activePointerIdRef.current = e.pointerId;
        pointerClaimedRef.current = true;

        // Polymorphic: resolve anchor index from adapter.
        const isBody = hit.target === "body";
        let anchorIndex = -1;
        if (!isBody) {
          const adapter = getTool(hit.drawing.tool);
          if (adapter) {
            const anchors = adapter.getAnchors(hit.drawing, toX, toY);
            const found = anchors.find((a) => a.target === hit.target);
            anchorIndex = found ? found.index : -1;
          }
          // Fallback for tools without getAnchors: p1→0, p2→1
          if (anchorIndex < 0) {
            anchorIndex =
              hit.target === "p1" ? 0 : hit.target === "p2" ? 1 : -1;
          }
        }

        const orig: Point[] = [
          ...hit.drawing.points.map((pt: Point) => ({ ...pt })),
        ];
        drawingIdRef.current = hit.drawing.id;
        livePointsRef.current = orig;
        transition({
          state: isBody ? "MovingDrawing" : "ResizingHandle",
          drawingId: hit.drawing.id,
          drawingTool: hit.drawing.tool,
          dragAnchor: anchorIndex,
          dragStart: p,
          dragOrig: orig,
        });
      }
    };

    const handleMove = (e: PointerEvent) => {
      const m = machineRef.current;

      // Drag path — polymorphic via adapter.move() / adapter.moveAnchor()
      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        if (!m.dragOrig || !m.dragStart || !m.drawingTool) return;
        const p = fromEvent(e);
        if (!p) return;

        const adapter = getTool(m.drawingTool);
        let next: Point[];
        if (m.dragAnchor >= 0) {
          // Anchor drag — move a single point.
          next = adapter
            ? adapter.moveAnchor(m.dragOrig, m.dragAnchor, p)
            : defaultMoveAnchor(m.dragOrig, m.dragAnchor, p);
        } else {
          // Body drag — translate all points.
          next = adapter
            ? adapter.move(m.dragOrig, p, m.dragStart)
            : defaultMove(m.dragOrig, p, m.dragStart);
        }

        livePointsRef.current = next;
        scheduleRedrawRef.current();
        return;
      }

      // Hover path
      const cur = getState();
      if (cur.activeTool !== "cursor") return;
      if (!canvas || !isOverCanvas(e, canvas)) {
        hoveredIdRef.current = null;
        return;
      }
      const p = fromEvent(e);
      if (!p) {
        hoveredIdRef.current = null;
        return;
      }
      const hit = hitTest(cur.drawings, p, toX, toY);
      hoveredIdRef.current = hit?.drawing.id ?? null;
    };

    const handleUp = () => {
      const m = machineRef.current;
      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        if (livePointsRef.current && drawingIdRef.current) {
          const newPoints = livePointsRef.current;
          const id = drawingIdRef.current;
          updateDrawing(id, { points: newPoints });
          if (commitMove && m.dragOrig) {
            commitMove(id, newPoints, m.dragOrig);
          }
        }
        releaseCapture();
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
    document.addEventListener("contextmenu", handleCtx, true);

    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointerleave", handleUp, true);
      document.removeEventListener("contextmenu", handleCtx, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ================================================================
  // KEYBOARD
  // ================================================================
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        undo?.();
        return;
      }
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        redo?.();
        return;
      }
      if (e.key === "Escape") {
        reset();
        setActiveTool("cursor");
        return;
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        selectAll?.();
        return;
      }

      const selId = getState().selectedDrawingId;
      if (!selId) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const d = getState().drawings.find((x) => x.id === selId);
        if (d && executeCommand) {
          executeCommand(
            new DeleteDrawingCommand(addDrawing, removeDrawing, d),
          );
        }
      }
      if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const d = getState().drawings.find((x) => x.id === selId);
        if (d) {
          duplicateDrawing?.(d.id);
          if (executeCommand) {
            executeCommand(
              new DuplicateDrawingCommand(addDrawing, removeDrawing, d),
            );
          }
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    undo,
    redo,
    reset,
    setActiveTool,
    selectAll,
    addDrawing,
    removeDrawing,
    executeCommand,
    duplicateDrawing,
    getState,
  ]);

  // ================================================================
  // CURSOR STYLE
  // ================================================================
  const drawingMode = getState().activeTool !== "cursor";
  let cursorStyle = "default";
  if (drawingMode) cursorStyle = "crosshair";
  if (machine.state === "MovingDrawing" || machine.state === "ResizingHandle") {
    cursorStyle = "move";
  }

  return {
    machine,
    cursorStyle,
    ctxMenu,
    setCtxMenu,
    reset,
    machineRef,
    livePointsRef,
    drawingIdRef,
    hoveredIdRef,
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
