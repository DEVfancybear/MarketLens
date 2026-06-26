"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import type { Drawing, Point, DrawingTool } from "@/types";
import { uid } from "@/utils/id";
import { hitTest, type HitResult } from "../hittest/HitTestEngine";
import { getTool, defaultMove, defaultMoveAnchor } from "../tools/ToolRegistry";
import type { DrawingMenuState } from "../../DrawingContextMenu";
import type { Command } from "../history/CommandManager";
import {
  DeleteDrawingCommand,
  DuplicateDrawingCommand,
} from "../history/CommandManager";

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
  dragAnchor: number;
  dragStart: Point | null;
  dragOrig: Point[] | null;
  multiDragOrig: Map<string, Point[]>;
}

export const INITIAL_MACHINE: Machine = {
  state: "Idle",
  anchors: [],
  drawingTool: null,
  drawingId: null,
  dragAnchor: -1,
  dragStart: null,
  dragOrig: null,
  multiDragOrig: new Map(),
};

function minPoints(t: DrawingTool): number {
  return getTool(t)?.minPoints ?? 2;
}

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
    selectedDrawingIds: Set<string>;
  };
  addDrawing: (d: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;
  selectDrawing: (id: string | null) => void;
  toggleSelectDrawing: (id: string) => void;
  setActiveTool: (t: DrawingTool) => void;
  scheduleRedraw: () => void;
  commitMove?: (id: string, newPoints: Point[], oldPoints: Point[]) => void;
  executeCommand?: (cmd: Command) => void;
  undo?: () => void;
  redo?: () => void;
  selectAll?: () => void;
  duplicateDrawing?: (id: string) => void;
}

export interface DrawingInteractionHandle {
  machine: Machine;
  cursorStyle: string;
  ctxMenu: DrawingMenuState | null;
  setCtxMenu: (m: DrawingMenuState | null) => void;
  reset: () => void;
  machineRef: React.RefObject<Machine | null>;
  livePointsRef: React.RefObject<Map<string, Point[]> | null>;
  drawingIdRef: React.RefObject<string | null>;
  hoveredIdRef: React.RefObject<string | null>;
  isPointerClaimed: () => boolean;
}

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
    toggleSelectDrawing,
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
  const livePointsRef = useRef<Map<string, Point[]> | null>(null);
  const drawingIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const pointerClaimedRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const transition = useCallback((next: Partial<Machine>) => {
    setMachine((prev) => ({ ...prev, ...next }));
    scheduleRedrawRef.current();
  }, []);
  const releaseCapture = useCallback(() => {
    const c = canvasRef.current;
    const p = activePointerIdRef.current;
    if (c && p != null) {
      try {
        c.releasePointerCapture(p);
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

  // ---- Drawing mode ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = getState();
    if (s.activeTool === "cursor") return;
    const hD = (e: PointerEvent) => {
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
      const n = minPoints(cur.activeTool);
      if (cur.activeTool === "text") {
        const t = window.prompt("Text:") || "";
        if (t)
          addDrawing({
            id: uid("dw"),
            tool: "text",
            color: cur.drawColor,
            lineWidth: 1.5,
            points: [p],
            text: t,
          });
        else {
          setActiveTool("cursor");
          releaseCapture();
          pointerClaimedRef.current = false;
        }
        return;
      }
      if (n === 1) {
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
    const hM = (e: PointerEvent) => {
      if (!canvas || !isOverCanvas(e, canvas)) return;
      const m = machineRef.current;
      if (m.state !== "Drawing") return;
      const p = fromEvent(e);
      if (!p) return;
      transition({ anchors: [m.anchors[0], p] });
    };
    document.addEventListener("pointerdown", hD, true);
    document.addEventListener("pointermove", hM, true);
    return () => {
      document.removeEventListener("pointerdown", hD, true);
      document.removeEventListener("pointermove", hM, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getState().activeTool]);

  // ---- Cursor mode ----
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

      // Shift-click → multi-select toggle.
      if (e.shiftKey && hit) {
        toggleSelectDrawing(hit.drawing.id);
        return;
      }
      selectDrawing(hit?.drawing.id ?? null);

      if (hit && !cur.drawingsLocked && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        canvas.setPointerCapture(e.pointerId);
        activePointerIdRef.current = e.pointerId;
        pointerClaimedRef.current = true;

        const selIds = cur.selectedDrawingIds;
        const isMulti = selIds.size > 1 && selIds.has(hit.drawing.id);
        const multiDragOrig = new Map<string, Point[]>();
        if (isMulti) {
          for (const sid of selIds) {
            const sd = cur.drawings.find((x) => x.id === sid);
            if (sd)
              multiDragOrig.set(
                sid,
                sd.points.map((pt: Point) => ({ ...pt })),
              );
          }
        }

        const isBody = hit.anchorIndex != null ? hit.anchorIndex < 0 : true;
        const anchorIndex = hit.anchorIndex ?? -1;
        const orig = hit.drawing.points.map((pt: Point) => ({ ...pt }));
        drawingIdRef.current = hit.drawing.id;
        livePointsRef.current = null;
        transition({
          state: isBody ? "MovingDrawing" : "ResizingHandle",
          drawingId: hit.drawing.id,
          drawingTool: hit.drawing.tool,
          dragAnchor: isMulti ? -1 : anchorIndex,
          dragStart: p,
          dragOrig: orig,
          multiDragOrig,
        });
      }
    };

    const handleMove = (e: PointerEvent) => {
      const m = machineRef.current;
      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        if (!m.dragStart || !m.drawingTool) return;
        const p = fromEvent(e);
        if (!p) return;
        const dt = p.time - m.dragStart.time,
          dp = p.price - m.dragStart.price;
        const multiMap = new Map<string, Point[]>();
        if (m.multiDragOrig.size > 0) {
          for (const [id, origPts] of m.multiDragOrig)
            multiMap.set(
              id,
              origPts.map((pt) => ({
                time: pt.time + dt,
                price: pt.price + dp,
              })),
            );
        } else {
          const adapter = getTool(m.drawingTool);
          const next =
            m.dragAnchor >= 0
              ? adapter
                ? adapter.moveAnchor(m.dragOrig!, m.dragAnchor, p)
                : defaultMoveAnchor(m.dragOrig!, m.dragAnchor, p)
              : adapter
                ? adapter.move(m.dragOrig!, p, m.dragStart)
                : defaultMove(m.dragOrig!, p, m.dragStart);
          multiMap.set(m.drawingId!, next);
        }
        livePointsRef.current = multiMap;
        scheduleRedrawRef.current();
        return;
      }
      // Hover
      const cur = getState();
      if (cur.activeTool !== "cursor") return;
      if (!canvas || !isOverCanvas(e, canvas)) {
        hoveredIdRef.current = null;
        return;
      }
      const hp = fromEvent(e);
      if (!hp) {
        hoveredIdRef.current = null;
        return;
      }
      const hit = hitTest(cur.drawings, hp, toX, toY);
      hoveredIdRef.current = hit?.drawing.id ?? null;
    };

    const handleUp = () => {
      const m = machineRef.current;
      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        const multiMap = livePointsRef.current;
        if (multiMap && multiMap.size > 0) {
          for (const [id, pts] of multiMap) {
            updateDrawing(id, { points: pts });
            if (commitMove) {
              const orig = m.multiDragOrig.get(id) ?? m.dragOrig;
              if (orig) commitMove(id, pts, orig);
            }
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

  // ---- Keyboard ----
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

      // Multi-delete
      if ((e.key === "Delete" || e.key === "Backspace") && executeCommand) {
        const selIds = getState().selectedDrawingIds;
        for (const id of selIds) {
          const d = getState().drawings.find((x) => x.id === id);
          if (d)
            executeCommand(
              new DeleteDrawingCommand(addDrawing, removeDrawing, d),
            );
        }
      }
      if (e.key === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const id = getState().selectedDrawingId;
        if (id) {
          const d = getState().drawings.find((x) => x.id === id);
          if (d) {
            duplicateDrawing?.(d.id);
            if (executeCommand)
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

  const dm = getState().activeTool !== "cursor";
  let cs = "default";
  if (dm) cs = "crosshair";
  if (machine.state === "MovingDrawing" || machine.state === "ResizingHandle")
    cs = "move";
  return {
    machine,
    cursorStyle: cs,
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
  const r = canvas.getBoundingClientRect();
  return (
    e.clientX >= r.left &&
    e.clientX <= r.right &&
    e.clientY >= r.top &&
    e.clientY <= r.bottom
  );
}
