"use client";
import { useRef, useState, useCallback, useEffect } from "react";
import type { Drawing, Point, DrawingTool } from "@/types";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";
import { uid } from "@/utils/id";
import { hitTest, type HitResult } from "../hittest/HitTestEngine";
import { getTool, defaultMove, defaultMoveAnchor } from "../tools/ToolRegistry";
import type { DrawingMenuState } from "../../DrawingContextMenu";
import type { Command } from "../history/CommandManager";
import {
  DeleteDrawingCommand,
  DuplicateDrawingCommand,
} from "../history/CommandManager";
import {
  createInitialMachine,
  INITIAL_MACHINE,
  type InteractionState,
  type Machine,
} from "./machine";
import { PointerFrameCoalescer } from "./PointerFrameCoalescer";

export {
  createInitialMachine,
  INITIAL_MACHINE,
  type InteractionState,
  type Machine,
} from "./machine";

function minPoints(t: DrawingTool): number {
  return getDrawingToolManifestEntry(t).minPoints;
}

function shouldRecordContinuousPoint(
  prev: Point | undefined,
  next: Point,
  toX: (time: number) => number | null,
  toY: (price: number) => number | null,
): boolean {
  if (!prev) return true;
  const x0 = toX(prev.time);
  const y0 = toY(prev.price);
  const x1 = toX(next.time);
  const y1 = toY(next.price);
  if (x0 == null || y0 == null || x1 == null || y1 == null) return true;
  return Math.hypot(x1 - x0, y1 - y0) >= 2;
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
  openDrawingSettings?: (id: string) => void;
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
    openDrawingSettings,
    onTextPlace,
    freezeChart,
  } = opts;
  const freezeChartRef = useRef(freezeChart);
  freezeChartRef.current = freezeChart;
  const openDrawingSettingsRef = useRef(openDrawingSettings);
  openDrawingSettingsRef.current = openDrawingSettings;

  const [machine, setMachine] = useState<Machine>(() => createInitialMachine());
  const [ctxMenu, setCtxMenu] = useState<DrawingMenuState | null>(null);
  const machineRef = useRef<Machine>(machine);
  const scheduleRedrawRef = useRef(scheduleRedraw);
  scheduleRedrawRef.current = scheduleRedraw;
  const livePointsRef = useRef<Map<string, Point[]> | null>(null);
  const livePointsWorkRef = useRef<Map<string, Point[]>>(new Map());
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverEventRef = useRef<PointerEvent | null>(null);
  const dragMoveCoalescerRef = useRef<PointerFrameCoalescer<PointerEvent> | null>(
    null,
  );
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
  const lastCursorDownRef = useRef<{
    id: string | null;
    x: number;
    y: number;
    t: number;
  } | null>(null);
  const patchMachine = useCallback((next: Partial<Machine>, publish = true) => {
    const updated = { ...machineRef.current, ...next };
    machineRef.current = updated;
    if (publish) setMachine(updated);
    scheduleRedrawRef.current();
  }, []);
  const transition = useCallback(
    (next: Partial<Machine>) => patchMachine(next, true),
    [patchMachine],
  );
  const previewTransition = useCallback(
    (next: Partial<Machine>) => patchMachine(next, false),
    [patchMachine],
  );
  const cancelHoverFrame = useCallback(() => {
    pendingHoverEventRef.current = null;
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
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
    const nextMachine = createInitialMachine();
    machineRef.current = nextMachine;
    setMachine(nextMachine);
    releaseCapture();
    pointerClaimedRef.current = false;
    dragActiveRef.current = false;
    dragMoveCoalescerRef.current?.cancel();
    livePointsRef.current = null;
    livePointsWorkRef.current.clear();
    drawingIdRef.current = null;
    cancelHoverFrame();
    committedRef.current = [];
    // Restore chart pan/zoom synchronously when the interaction ends.
    freezeChartRef.current?.(false);
    scheduleRedrawRef.current();
  }, [cancelHoverFrame, releaseCapture]);

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
      const creation = getDrawingToolManifestEntry(cur.activeTool);
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
              lineWidth: creation.defaultProperties.lineWidth,
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
      if (creation.creationMode === "pointer-continuous") {
        committedRef.current = [p];
        dragActiveRef.current = true;
        freezeChartRef.current?.(true);
        transition({
          state: "Drawing",
          anchors: [p],
          drawingTool: cur.activeTool,
        });
        return;
      }
      if (n === 1) {
        addDrawing({
          id: uid("dw"),
          tool: cur.activeTool,
          color: cur.drawColor,
          lineWidth: creation.defaultProperties.lineWidth,
          points: [p],
        });
        return;
      }

      // ---- Multi-point tools (triangle, arc, double-curve, polyline, …) ----
      // The manifest selects the multi-point creation contract; 1-/2-point
      // tools skip this entirely and keep their original path below.
      const maxPts = creation.maxPoints;
      const isFreeform = creation.creationMode === "click-freeform";
      const isMulti = isFreeform || creation.creationMode === "fixed-multi-point";
      if (isMulti) {
        const commit = (pts: Point[]) => {
          addDrawing({
            id: uid("dw"),
            tool: cur.activeTool,
            color: cur.drawColor,
            lineWidth: creation.defaultProperties.lineWidth,
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
        if (isFreeform && isDouble) {
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
          lineWidth: creation.defaultProperties.lineWidth,
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
      const tool = m.drawingTool ?? getState().activeTool;
      const creation = getDrawingToolManifestEntry(tool);
      if (creation.creationMode === "pointer-continuous") {
        e.preventDefault();
        e.stopPropagation();
        const committed = committedRef.current;
        const last = committed[committed.length - 1];
        if (shouldRecordContinuousPoint(last, p, toX, toY)) {
          const next = [...committed, p];
          committedRef.current = next;
          previewTransition({ anchors: next });
        }
        return;
      }
      // Multi-point draw: preview the already-committed points plus the live
      // cursor as the next vertex. 2-point tools keep [start, cursor].
      const committed = committedRef.current;
      if (committed.length > 0) {
        previewTransition({ anchors: [...committed, p] });
      } else {
        previewTransition({ anchors: [m.anchors[0], p] });
      }
    };
    const hU = (e: PointerEvent) => {
      const m = machineRef.current;
      if (m.state !== "Drawing") return;
      const tool = m.drawingTool ?? getState().activeTool;
      const creation = getDrawingToolManifestEntry(tool);
      if (creation.creationMode !== "pointer-continuous") return;
      e.preventDefault();
      e.stopPropagation();

      let pts = committedRef.current;
      const p = fromEvent(e);
      const last = pts[pts.length - 1];
      if (p && shouldRecordContinuousPoint(last, p, toX, toY)) {
        pts = [...pts, p];
      }
      if (pts.length >= creation.minPoints) {
        addDrawing({
          id: uid("dw"),
          tool,
          color: getState().drawColor,
          lineWidth: creation.defaultProperties.lineWidth,
          points: pts.map((q) => ({ ...q })),
        });
      }
      reset();
    };
    const hCancel = () => {
      const m = machineRef.current;
      const tool = m.drawingTool ?? getState().activeTool;
      const creation = getDrawingToolManifestEntry(tool);
      if (m.state === "Drawing" && creation.creationMode === "pointer-continuous") reset();
    };
    document.addEventListener("pointerdown", hD, true);
    document.addEventListener("pointermove", hM, true);
    document.addEventListener("pointerup", hU, true);
    document.addEventListener("pointercancel", hCancel, true);
    return () => {
      document.removeEventListener("pointerdown", hD, true);
      document.removeEventListener("pointermove", hM, true);
      document.removeEventListener("pointerup", hU, true);
      document.removeEventListener("pointercancel", hCancel, true);
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

      if (hit && e.button === 0) {
        const prev = lastCursorDownRef.current;
        const isDouble =
          !!prev &&
          prev.id === hit.drawing.id &&
          e.timeStamp - prev.t < 350 &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 6;
        lastCursorDownRef.current = {
          id: hit.drawing.id,
          x: e.clientX,
          y: e.clientY,
          t: e.timeStamp,
        };
        if (isDouble && openDrawingSettingsRef.current) {
          e.preventDefault();
          e.stopPropagation();
          openDrawingSettingsRef.current(hit.drawing.id);
          return;
        }
      } else {
        lastCursorDownRef.current = {
          id: null,
          x: e.clientX,
          y: e.clientY,
          t: e.timeStamp,
        };
      }

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
        livePointsWorkRef.current.clear();
        livePointsRef.current = null;
        cancelHoverFrame();
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

    const applyDragMove = (e: PointerEvent) => {
      const m = machineRef.current;
      if (
        (m.state !== "MovingDrawing" && m.state !== "ResizingHandle") ||
        !m.dragStart ||
        !m.drawingTool
      ) {
        return;
      }
      const p = fromEvent(e);
      if (!p) return;
      const dt = p.time - m.dragStart.time,
        dp = p.price - m.dragStart.price;
      const multiMap = livePointsWorkRef.current;
      multiMap.clear();
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
    };
    const dragMoves = new PointerFrameCoalescer<PointerEvent>(applyDragMove);
    dragMoveCoalescerRef.current = dragMoves;

    const handleMove = (e: PointerEvent) => {
      const m = machineRef.current;
      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        e.preventDefault();
        e.stopPropagation();
        dragMoves.push(e);
        return;
      }
      // Hover
      const cur = getState();
      if (cur.activeTool !== "cursor") return;
      if (!canvas || !isOverCanvas(e, canvas)) {
        cancelHoverFrame();
        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null;
          scheduleRedrawRef.current();
        }
        return;
      }
      pendingHoverEventRef.current = e;
      if (hoverRafRef.current == null) {
        hoverRafRef.current = requestAnimationFrame(() => {
          hoverRafRef.current = null;
          const event = pendingHoverEventRef.current;
          pendingHoverEventRef.current = null;
          const state = getState();
          if (
            !event ||
            machineRef.current.state !== "Idle" ||
            state.activeTool !== "cursor"
          ) {
            return;
          }
          const hp = fromEvent(event);
          if (!hp) {
            if (hoveredIdRef.current !== null) {
              hoveredIdRef.current = null;
              scheduleRedrawRef.current();
            }
            return;
          }
          const hit = hitTest(state.drawings, hp, toX, toY);
          const nextHoveredId = hit?.drawing.id ?? null;
          if (hoveredIdRef.current !== nextHoveredId) {
            hoveredIdRef.current = nextHoveredId;
            scheduleRedrawRef.current();
          }
        });
      }
    };

    const handleUp = (e: PointerEvent) => {
      const m = machineRef.current;
      // Always release the chart-event block on any pointer release, even if the
      // machine never reached a drag state, so the blocker can never get stuck.
      dragActiveRef.current = false;

      if (m.state === "MovingDrawing" || m.state === "ResizingHandle") {
        e.preventDefault();
        e.stopPropagation();
        dragMoves.flush(e);
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
        livePointsWorkRef.current.clear();
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
        const creation = getDrawingToolManifestEntry(tool);
        const pts = committedRef.current;
        if (creation.creationMode === "click-freeform" && pts.length >= creation.minPoints) {
          addDrawing({
            id: uid("dw"),
            tool,
            color: cur.drawColor,
            lineWidth: creation.defaultProperties.lineWidth,
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
      dragMoves.cancel();
      if (dragMoveCoalescerRef.current === dragMoves) {
        dragMoveCoalescerRef.current = null;
      }
      cancelHoverFrame();
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
        const m = machineRef.current;
        if (m.state === "Drawing") {
          const cur = getState();
          const tool = m.drawingTool ?? cur.activeTool;
          const creation = getDrawingToolManifestEntry(tool);
          const pts = committedRef.current;
          if (creation.creationMode === "click-freeform" && pts.length >= creation.minPoints) {
            addDrawing({
              id: uid("dw"),
              tool,
              color: cur.drawColor,
              lineWidth: creation.defaultProperties.lineWidth,
              points: pts.map((q) => ({ ...q })),
            });
          }
        }
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
