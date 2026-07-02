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
  "Idle" | "Drawing" | "MovingDrawing" | "ResizingHandle";

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
  updateDrawing: (arg: { id: string; patch: Partial<Drawing> }) => void;
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
  /** Called when Text tool is used. If provided, replaces window.prompt. */
  onTextPlace?: (point: Point, color: string) => void;
  /**
   * Synchronously freeze (busy=true) / restore (busy=false) the chart's pan &
   * zoom. Invoked the instant a drag or draw begins — inside the pointerdown
   * handler, before any pointermove can fire — so a fast drag can't leak the
   * first move(s) into the chart's pressedMouseMove pan/scale handler.
   */
  freezeChart?: (busy: boolean) => void;
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
    onTextPlace,
    freezeChart,
  } = opts;
  const freezeChartRef = useRef(freezeChart);
  freezeChartRef.current = freezeChart;

  const [machine, setMachine] = useState<Machine>(INITIAL_MACHINE);
  const [ctxMenu, setCtxMenu] = useState<DrawingMenuState | null>(null);
  const machineRef = useRef<Machine>(machine);
  machineRef.current = machine;
  const scheduleRedrawRef = useRef(scheduleRedraw);
  scheduleRedrawRef.current = scheduleRedraw;
  const livePointsRef = useRef<Map<string, Point[]> | null>(null);
  // Confirmed click points for an in-progress multi-point draw (polyline, path,
  // curve, triangle, arc, double-curve). Empty for 1-/2-point tools.
  const committedRef = useRef<Point[]>([]);
  const drawingIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const clipboardRef = useRef<Drawing | null>(null);
  const pointerClaimedRef = useRef(false);
  // True for the exact duration of a body-move / handle-resize drag. Set
  // synchronously on pointerdown and cleared on release. Gates the capture-phase
  // mouse/touch/wheel blocker below so a fast drag can't leak ANY event into
  // lightweight-charts' own mouse handlers (LWC listens to mousedown/mousemove,
  // NOT pointer events, so merely stopping pointerdown propagation never blocked
  // its pan; the option-freeze raced against the first leaked move).
  const dragActiveRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  // Manual double-click detection for finishing freeform draws (Path, Polyline…).
  // `PointerEvent.detail` is unreliable on `pointerdown` (0 in many browsers), so
  // we track the previous down's time + screen position instead.
  const lastDownRef = useRef<{ x: number; y: number; t: number } | null>(null);
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
    dragActiveRef.current = false;
    committedRef.current = [];
    // Restore chart pan/zoom synchronously when the interaction ends.
    freezeChartRef.current?.(false);
    scheduleRedrawRef.current();
  }, [releaseCapture]);

  // ---- Drawing mode ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Any tool change cancels an in-progress multi-point draw so a half-placed
    // anchor can't bleed into the newly selected tool.
    if (machineRef.current.state === "Drawing") reset();
    const s = getState();
    if (s.activeTool === "cursor") return;
    const hD = (e: PointerEvent) => {
      if (isOverDrawingUI(e)) return;
      if (!canvas || !isOverCanvas(e, canvas)) return;
      // Only the primary (left / touch / pen) button draws. Right / middle
      // clicks are left to the contextmenu handler, which finishes a freeform
      // draw — otherwise a right-click would also drop a stray point first.
      if (e.button > 0) return;
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
        if (onTextPlace) {
          onTextPlace(p, cur.drawColor);
          releaseCapture();
          pointerClaimedRef.current = false;
          setActiveTool("cursor");
        } else {
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

      // ---- Multi-point tools (triangle, arc, double-curve, polyline, …) ----
      // Opt-in via the plugin's `freeform`/`maxPoints` flags; 1-/2-point tools
      // skip this entirely and keep their original path below.
      const adapter = getTool(cur.activeTool);
      const maxPts = adapter?.maxPoints;
      const isMulti = !!adapter?.freeform || (maxPts ?? 0) > 2 || n > 2;
      if (isMulti) {
        const commit = (pts: Point[]) => {
          addDrawing({
            id: uid("dw"),
            tool: cur.activeTool,
            color: cur.drawColor,
            lineWidth: 1.5,
            points: pts.map((q) => ({ ...q })),
          });
          committedRef.current = [];
          reset();
        };
        if (m.state !== "Drawing") {
          committedRef.current = [p];
          lastDownRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
          transition({
            state: "Drawing",
            anchors: [p],
            drawingTool: cur.activeTool,
          });
          return;
        }
        // A double-click finishes a freeform draw: a second press at (almost) the
        // same spot within 350ms. The first press of the double already committed
        // its point, so we finish with the points we have (no duplicate added).
        const prev = lastDownRef.current;
        const isDouble =
          !!prev &&
          e.timeStamp - prev.t < 350 &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 6;
        lastDownRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        if (adapter?.freeform && isDouble) {
          if (committedRef.current.length >= n) commit(committedRef.current);
          else reset();
          return;
        }
        const next = [...committedRef.current, p];
        committedRef.current = next;
        if (maxPts != null && next.length >= maxPts) commit(next);
        else transition({ anchors: next });
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
      // Multi-point draw: preview the already-committed points plus the live
      // cursor as the next vertex. 2-point tools keep [start, cursor].
      const committed = committedRef.current;
      if (committed.length > 0) transition({ anchors: [...committed, p] });
      else transition({ anchors: [m.anchors[0], p] });
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
      // Ignore clicks that land on the floating drawing settings toolbar /
      // its popovers — they must not deselect the drawing or start a drag.
      if (isOverDrawingUI(e)) return;
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
        // setPointerCapture is NOT used because canvas has pointerEvents:"none"
        // which prevents captured events from reaching ANY listener.
        // Instead, document-level capture-phase listeners catch all events.
        activePointerIdRef.current = e.pointerId;
        pointerClaimedRef.current = true;
        // Block LWC's mouse handlers for the whole drag (see dragActiveRef) and
        // freeze pan/zoom as a second line of defence. Both are applied
        // synchronously here, before the first move can fire.
        dragActiveRef.current = true;
        freezeChartRef.current?.(true);

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
        // Clear TP/SL hit status when the user starts dragging.  Clearing
        // hitTime too lets the renderer fresh-detect with live points during
        // the drag so the highlight updates in real-time (no delay).
        if (
          hit.drawing.tradeStatus === "tp_hit" ||
          hit.drawing.tradeStatus === "sl_hit"
        ) {
          updateDrawing({
            id: hit.drawing.id,
            patch: {
              tradeStatus: undefined,
              hitTime: undefined,
              hitPrice: undefined,
            },
          });
        }
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
      // Always release the chart-event block on any pointer release, even if the
      // machine never reached a drag state, so the blocker can never get stuck.
      dragActiveRef.current = false;

      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        const multiMap = livePointsRef.current;
        if (multiMap && multiMap.size > 0) {
          for (const [id, pts] of multiMap) {
            updateDrawing({ id, patch: { points: pts } });
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
        // Right-click finishes an in-progress freeform draw (else cancels).
        const tool = m.drawingTool ?? cur.activeTool;
        const adapter = getTool(tool);
        const pts = committedRef.current;
        if (adapter?.freeform && pts.length >= adapter.minPoints) {
          addDrawing({
            id: uid("dw"),
            tool,
            color: cur.drawColor,
            lineWidth: 1.5,
            points: pts.map((q) => ({ ...q })),
          });
        }
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

    // While a body-move / handle-resize drag is in progress, swallow the raw
    // mouse / touch / wheel events in the capture phase so they never reach
    // lightweight-charts' own listeners (which pan & scale the view). This is
    // what actually stops the "view jump": LWC reacts to mousedown/mousemove,
    // and the drawing canvas being pointerEvents:"none" means those events would
    // otherwise flow straight to the chart underneath.
    const blockChartEvent = (e: Event) => {
      if (!dragActiveRef.current) return;
      e.stopImmediatePropagation();
      e.stopPropagation();
    };

    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerup", handleUp, true);
    document.addEventListener("pointerleave", handleUp, true);
    document.addEventListener("contextmenu", handleCtx, true);
    document.addEventListener("mousedown", blockChartEvent, true);
    document.addEventListener("mousemove", blockChartEvent, true);
    document.addEventListener("wheel", blockChartEvent, true);
    document.addEventListener("touchstart", blockChartEvent, true);
    document.addEventListener("touchmove", blockChartEvent, true);
    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointerleave", handleUp, true);
      document.removeEventListener("contextmenu", handleCtx, true);
      document.removeEventListener("mousedown", blockChartEvent, true);
      document.removeEventListener("mousemove", blockChartEvent, true);
      document.removeEventListener("wheel", blockChartEvent, true);
      document.removeEventListener("touchstart", blockChartEvent, true);
      document.removeEventListener("touchmove", blockChartEvent, true);
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
      if (e.key === "c" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        const id = getState().selectedDrawingId;
        if (id)
          clipboardRef.current =
            getState().drawings.find((x) => x.id === id) ?? null;
        return;
      }
      if (e.key === "v" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        const src = clipboardRef.current;
        // executeCommand alone both creates the copy (with a fresh id) and
        // records undo — do NOT also call addDrawing directly here, or paste
        // creates two independent copies (confirmed via a real repro).
        if (src && executeCommand) {
          executeCommand(
            new DuplicateDrawingCommand(addDrawing, removeDrawing, src),
          );
        }
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
          // executeCommand alone both creates the copy and records undo — do
          // NOT also call duplicateDrawing() here, or Ctrl+D creates two
          // independent copies with two different ids (confirmed via a real
          // repro). onCreated re-selects the new copy, matching what
          // duplicateDrawing() used to do as a side effect.
          if (d && executeCommand) {
            executeCommand(
              new DuplicateDrawingCommand(addDrawing, removeDrawing, d, (copy) =>
                selectDrawing(copy.id),
              ),
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
    selectDrawing,
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

/** True if the event originated inside a floating chart-UI surface that
 *  overlays the canvas (drawing settings toolbar + popovers, the left
 *  toolbar's tool flyout, context menus). Such clicks must NOT be treated as
 *  chart clicks — otherwise an armed single-click tool (e.g. horizontal ray)
 *  would create a phantom drawing under the menu before the button's own
 *  onClick runs. Coordinate-based `isOverCanvas` can't tell these apart, so we
 *  test the event target's DOM ancestry. */
function isOverDrawingUI(e: PointerEvent | MouseEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.("[data-drawing-toolbar],[data-chart-ui]");
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
