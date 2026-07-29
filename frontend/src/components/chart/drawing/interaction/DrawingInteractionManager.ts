"use client";
import {
  useRef,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";
import type {
  Candle,
  Drawing,
  DrawingDataTick,
  DrawingTool,
  Point,
  Timeframe,
} from "../../../../types";
import {
  resolveGannConfig,
  TF_SECONDS,
  type GannConfig,
} from "../../../../types";
import { getDrawingToolManifestEntry } from "../../../../types/drawingToolManifest";
import { uid } from "@/utils/id";
import { hitTest, type HitResult } from "../hittest/HitTestEngine";
import type { DrawingMenuState } from "../../DrawingContextMenu";
import type { Command, DrawingMoveChange } from "../history/CommandManager";
import {
  DeleteDrawingCommand,
  DeleteDrawingsCommand,
  DuplicateDrawingCommand,
} from "../history/CommandManager";
import {
  createInitialMachine,
  INITIAL_MACHINE,
  type InteractionState,
  type Machine,
} from "./machine";
import { PointerFrameCoalescer } from "./PointerFrameCoalescer";
import { getFrameClientRect } from "./FrameRectCache";
import {
  advanceCreationDrag,
  createCreationDragState,
  type CreationDragState,
} from "./CreationGesture";
import {
  CreationSession,
  type CreationSessionOutcome,
} from "./CreationSession";
import { TransformSession } from "./TransformSession";
import { constrainMovePointerToAxis } from "./transformConstraints";
import {
  nudgeDrawingPoints,
  type DrawingNudgeDirection,
} from "./drawingNudge";
import { EraseSession } from "./EraseSession";
import { SelectionSession } from "./SelectionSession";
import { simplifyProjectedPoints } from "./FreeformSimplification";
import { constrainPointTo45Degrees } from "../tools/plugins/lineGeometry";
import {
  resolveDrawingCreationDefaults,
  type DrawingToolPreferences,
} from "../settings/drawingToolPreferences";
import { buildDrawingDataSnapshot } from "../data/drawingDataSnapshot";
import {
  selectCachedVolumeProfileHistory,
  type VolumeProfileHistoryRequest,
} from "../data/volumeProfileHistory";
import type { DrawingAdapterInteractionContext } from "../tools/ToolRegistry";
import {
  constrainGannAnchor,
  constrainGannResize,
} from "../tools/plugins/gannGeometry";

export {
  createInitialMachine,
  INITIAL_MACHINE,
  type InteractionState,
  type Machine,
} from "./machine";

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

function withPointerPressure(point: Point, event: PointerEvent): Point {
  return event.pointerType === "pen" && Number.isFinite(event.pressure)
    ? { ...point, pressure: Math.max(0, Math.min(1, event.pressure)) }
    : point;
}

function coalescedPointerSamples(event: PointerEvent): readonly PointerEvent[] {
  try {
    const samples = event.getCoalescedEvents?.();
    if (samples?.length) return samples;
  } catch {
    // Some embedded browsers expose the method without allowing it to run.
  }
  return [event];
}

function latestPointerSample(event: PointerEvent): PointerEvent {
  const samples = coalescedPointerSamples(event);
  return samples[samples.length - 1] ?? event;
}

export interface InteractionStateReadOptions {
  /** Expensive tick/history copies are only required by profile-tool commits. */
  includeSnapshotData?: boolean;
}

export interface DrawingInteractionManagerOpts {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  fromEvent: (e: PointerEvent) => Point | null;
  toX: (time: number) => number | null;
  toY: (price: number) => number | null;
  getState: (options?: InteractionStateReadOptions) => {
    drawings: Drawing[];
    activeTool: DrawingTool;
    drawColor: string;
    drawingToolPreferences: DrawingToolPreferences;
    drawingsLocked: boolean;
    ctxReady: boolean;
    selectedDrawingId: string | null;
    selectedDrawingIds: Set<string>;
    candles: Candle[];
    symbol: string;
    timeframe?: Timeframe;
    cachedCandles?: Record<string, Candle[]>;
    recentTicks?: DrawingDataTick[];
    recentTickCoverage?: { start: number; end: number };
    adapterContext?: DrawingAdapterInteractionContext;
  };
  addDrawing: (d: Drawing) => void;
  updateDrawing: (arg: { id: string; patch: Partial<Drawing> }) => void;
  removeDrawing: (id: string) => void;
  selectDrawing: (id: string | null) => void;
  toggleSelectDrawing: (id: string) => void;
  setActiveTool: (t: DrawingTool) => void;
  scheduleRedraw: () => void;
  commitMoves: (changes: readonly DrawingMoveChange[]) => void;
  executeCommand?: (cmd: Command) => void;
  undo?: () => void;
  redo?: () => void;
  selectAll?: () => void;
  duplicateDrawing?: (id: string) => void;
  openDrawingSettings?: (id: string) => void;
  /** Called when the Text tool is placed so the React inline editor can open. */
  onTextPlace?: (tool: DrawingTool, point: Point, color: string) => void;
  /** Capability-aware OHLC snapping supplied by the chart composition root. */
  snapPoint?: (point: Point, tool: DrawingTool, event: PointerEvent) => Point;
  /** Changing this value cancels any in-flight interaction synchronously. */
  cancellationKey?: string;
  /**
   * Synchronously freeze (busy=true) / restore (busy=false) the chart's pan &
   * zoom. Invoked the instant a drag or draw begins — inside the pointerdown
   * handler, before any pointermove can fire — so a fast drag can't leak the
   * first move(s) into the chart's pressedMouseMove pan/scale handler.
   */
  freezeChart?: (busy: boolean) => void;
  /** Optional normal-history enrichment for capability-declared profile tools. */
  loadVolumeProfileHistory?: (
    request: VolumeProfileHistoryRequest,
  ) => Promise<readonly Candle[] | undefined>;
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
    commitMoves,
    executeCommand,
    undo,
    redo,
    selectAll,
    openDrawingSettings,
    onTextPlace,
    snapPoint,
    freezeChart,
    loadVolumeProfileHistory,
    cancellationKey,
  } = opts;
  const freezeChartRef = useRef(freezeChart);
  freezeChartRef.current = freezeChart;
  const openDrawingSettingsRef = useRef(openDrawingSettings);
  openDrawingSettingsRef.current = openDrawingSettings;
  const snapPointRef = useRef(snapPoint);
  snapPointRef.current = snapPoint;
  const loadVolumeProfileHistoryRef = useRef(loadVolumeProfileHistory);
  loadVolumeProfileHistoryRef.current = loadVolumeProfileHistory;

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
  const creationMoveCoalescerRef = useRef<PointerFrameCoalescer<PointerEvent> | null>(
    null,
  );
  const creationSessionRef = useRef<CreationSession | null>(null);
  const creationDragRef = useRef<CreationDragState | null>(null);
  // A two-point tool can commit on pointerdown (the click-click flow). Keep
  // that physical pointer transaction quarantined until its matching pointerup;
  // otherwise a browser/embedded surface that replays a move/down while the
  // finishing button is still held can immediately arm the next drawing.
  const creationReleaseGuardRef = useRef<number | null>(null);
  const transformSessionRef = useRef<TransformSession | null>(null);
  const eraseSessionRef = useRef(
    new EraseSession(
      (drawings, point) => hitTest(drawings as Drawing[], point, toX, toY)?.drawing ?? null,
    ),
  );
  const selectionSessionRef = useRef(new SelectionSession());
  const suppressNativeDoubleClickUntilRef = useRef(0);
  const drawingIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const clipboardRef = useRef<Drawing | null>(null);
  const pendingGannRatioRef = useRef<{
    drawingId: string;
    gann: GannConfig;
  } | null>(null);
  const originalGannRef = useRef<GannConfig | undefined>(undefined);
  const originalResolvedTradeRef = useRef<{
    drawingId: string;
    tradeStatus: "tp_hit" | "sl_hit";
    hitTime: number | undefined;
    hitPrice: number | undefined;
  } | null>(null);
  const pointerClaimedRef = useRef(false);
  // True for the exact duration of a body-move / handle-resize drag. Set
  // synchronously on pointerdown and cleared on release. Gates the capture-phase
  // mouse/touch/wheel blocker below so a fast drag can't leak ANY event into
  // lightweight-charts' own mouse handlers (LWC listens to mousedown/mousemove,
  // NOT pointer events, so merely stopping pointerdown propagation never blocked
  // its pan; the option-freeze raced against the first leaked move).
  const dragActiveRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const captureTargetRef = useRef<Element | null>(null);
  // Manual double-click detection for finishing freeform draws (Path, Polyline…).
  // `PointerEvent.detail` is unreliable on `pointerdown` (0 in many browsers), so
  // we track the previous down's time + screen position instead.
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
  const cancelHoverFrame = useCallback(() => {
    pendingHoverEventRef.current = null;
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
  }, []);
  const capturePointer = useCallback((event: PointerEvent, fallback: Element) => {
    const target = event.target instanceof Element ? event.target : fallback;
    try {
      target.setPointerCapture(event.pointerId);
      captureTargetRef.current = target;
    } catch {
      // Document capture listeners remain the compatibility fallback.
      captureTargetRef.current = null;
    }
  }, []);
  const releaseCapture = useCallback(() => {
    const c = captureTargetRef.current ?? canvasRef.current;
    const p = activePointerIdRef.current;
    // Clear ownership before releasePointerCapture can dispatch
    // lostpointercapture, preventing a normal release from looking cancelled.
    activePointerIdRef.current = null;
    captureTargetRef.current = null;
    if (c && p != null) {
      try {
        c.releasePointerCapture(p);
      } catch {
        /* ok */
      }
    }
  }, [canvasRef]);
  const reset = useCallback(() => {
    const nextMachine = createInitialMachine();
    machineRef.current = nextMachine;
    setMachine(nextMachine);
    releaseCapture();
    pointerClaimedRef.current = false;
    dragActiveRef.current = false;
    dragMoveCoalescerRef.current?.cancel();
    creationMoveCoalescerRef.current?.cancel();
    livePointsRef.current = null;
    livePointsWorkRef.current.clear();
    drawingIdRef.current = null;
    cancelHoverFrame();
    creationSessionRef.current = null;
    creationDragRef.current = null;
    transformSessionRef.current = null;
    pendingGannRatioRef.current = null;
    originalGannRef.current = undefined;
    originalResolvedTradeRef.current = null;
    // Restore chart pan/zoom synchronously when the interaction ends.
    freezeChartRef.current?.(false);
    scheduleRedrawRef.current();
  }, [cancelHoverFrame, releaseCapture]);

  const applyCreationOutcome = useCallback(
    (outcome: CreationSessionOutcome) => {
      const session = creationSessionRef.current;
      if (!session) return;
      if (outcome.kind === "preview") {
        // Canvas reads machineRef directly. Publish only the transition into
        // Drawing; anchor-only previews stay off React's reconciliation path.
        const publish = machineRef.current.state !== "Drawing";
        patchMachine({
          state: "Drawing",
          anchors: outcome.points,
          drawingTool: session.tool,
        }, publish);
        return;
      }
      if (outcome.kind === "commit") {
        const profileDetail = session.definition.dataSnapshotDetail === "volume-profile";
        const cur = getState({ includeSnapshotData: profileDetail });
        const tolerance = session.definition.pointSimplificationTolerance;
        const points = tolerance
          ? simplifyProjectedPoints(outcome.points, toX, toY, tolerance)
          : outcome.points;
        const capturedAt = Math.floor(Date.now() / 1000);
        const historyRequest = profileDetail && session.definition.dataSnapshot && cur.timeframe
          ? {
              mode: session.definition.dataSnapshot,
              points: points.map((point) => ({ ...point })),
              candles: cur.candles.map((candle) => ({ ...candle })),
              symbol: cur.symbol,
              timeframe: cur.timeframe,
              capturedAt,
            } satisfies VolumeProfileHistoryRequest
          : undefined;
        const lowerTimeframeBars = historyRequest && cur.cachedCandles
          ? selectCachedVolumeProfileHistory(historyRequest, cur.cachedCandles)
          : undefined;
        const detailStart = session.definition.dataSnapshot === "between-anchors" && points[1]
          ? Math.min(points[0].time, points[1].time)
          : points[0]?.time ?? capturedAt;
        const detailEnd = session.definition.dataSnapshot === "between-anchors" && points[1]
          ? Math.min(
              Math.max(points[0].time, points[1].time) +
                (cur.timeframe ? TF_SECONDS[cur.timeframe] : 0),
              capturedAt,
            )
          : capturedAt;
        const ticks = profileDetail
          ? cur.recentTicks?.filter(
              (tick) => tick.time !== undefined && tick.time >= detailStart && tick.time < detailEnd,
            )
          : undefined;
        const dataSnapshot = session.definition.dataSnapshot
          ? buildDrawingDataSnapshot(
              session.definition.dataSnapshot,
              points,
              cur.candles,
              cur.symbol,
              capturedAt,
              profileDetail
                ? {
                    lowerTimeframeBars,
                    ticks,
                    tickCoverage: cur.recentTickCoverage,
                  }
                : undefined,
            )
          : undefined;
        const drawingId = uid("dw");
        addDrawing({
          ...resolveDrawingCreationDefaults(
            session.tool,
            cur.drawingToolPreferences.toolDefaults[session.tool],
            cur.drawColor,
          ),
          id: drawingId,
          tool: session.tool,
          points,
          ...(dataSnapshot ? { dataSnapshot } : {}),
        } as Drawing);
        if (
          historyRequest &&
          !lowerTimeframeBars &&
          loadVolumeProfileHistoryRef.current
        ) {
          const initialTicks = ticks?.map((tick) => ({ ...tick }));
          const tickCoverage = cur.recentTickCoverage
            ? { ...cur.recentTickCoverage }
            : undefined;
          void loadVolumeProfileHistoryRef.current(historyRequest).then((loadedBars) => {
            if (!loadedBars?.length) return;
            const enriched = buildDrawingDataSnapshot(
              historyRequest.mode,
              historyRequest.points,
              historyRequest.candles,
              historyRequest.symbol,
              historyRequest.capturedAt,
              {
                lowerTimeframeBars: loadedBars,
                ticks: initialTicks,
                tickCoverage,
              },
            );
            if (enriched) updateDrawing({ id: drawingId, patch: { dataSnapshot: enriched } });
          }).catch(() => {
            // The initial chart-timeframe snapshot remains authoritative.
          });
        }
      }
      reset();
    },
    [addDrawing, getState, patchMachine, reset, toX, toY, updateDrawing],
  );
  const cancellationKeyRef = useRef(cancellationKey);
  cancellationKeyRef.current = cancellationKey;
  const previousCancellationKeyRef = useRef(cancellationKey);
  useLayoutEffect(() => {
    if (
      previousCancellationKeyRef.current !== undefined &&
      previousCancellationKeyRef.current !== cancellationKey
    ) {
      reset();
      setActiveTool("crosshair");
    }
    previousCancellationKeyRef.current = cancellationKey;
  }, [cancellationKey, reset, setActiveTool]);
  const activeTool = getState().activeTool;
  const previousActiveToolRef = useRef(activeTool);
  useLayoutEffect(() => {
    if (
      previousActiveToolRef.current !== activeTool &&
      machineRef.current.state !== "Idle"
    ) {
      reset();
    }
    previousActiveToolRef.current = activeTool;
  }, [activeTool, reset]);

  // ---- Drawing mode ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (event: PointerEvent) => {
      if (creationReleaseGuardRef.current != null) return;
      if (isOverDrawingUI(event) || !isOverCanvas(event, canvas) || event.button > 0) return;
      // Keep this listener mounted across tool switches. Jotai updates the
      // active tool synchronously, while a React effect keyed by activeTool can
      // run one frame later; conditionally attaching here used to drop the
      // first fast mouse/touch tap after selecting a drawing tool.
      const current = getState();
      const definition = getDrawingToolManifestEntry(current.activeTool);
      if (!definition.persistent) return;
      // A render caused by the toolbar/symbol update may have committed while
      // its reconciliation layout effect is still queued. This pointer belongs
      // to the values visible now, so acknowledge them before transitioning;
      // later genuine tool/symbol changes still cancel the active session.
      previousActiveToolRef.current = current.activeTool;
      previousCancellationKeyRef.current = cancellationKeyRef.current;
      const currentMachine = machineRef.current;
      if (currentMachine.state !== "Idle" && currentMachine.state !== "Drawing") return;
      const raw = fromEvent(event);
      const rawPoint = raw ? withPointerPressure(raw, event) : null;
      if (!rawPoint || !current.ctxReady) return;

      event.preventDefault();
      event.stopPropagation();
      // Drawing and cursor handlers are both capture listeners on `document`.
      // A commit can synchronously reset to Cursor and add/select the drawing;
      // without stopping sibling listeners, this same pointerdown immediately
      // starts a phantom resize/move on the newly-created object.
      event.stopImmediatePropagation();
      capturePointer(event, canvas);
      activePointerIdRef.current = event.pointerId;
      pointerClaimedRef.current = true;

      let point = definition.magnetEligible
        ? snapPointRef.current?.(rawPoint, current.activeTool, event) ?? rawPoint
        : rawPoint;
      if (definition.overlayExtension === "text-editor") {
        onTextPlace?.(current.activeTool, point, current.drawColor);
        reset();
        if (!current.drawingToolPreferences.keepDrawing) setActiveTool("crosshair");
        return;
      }

      let session = creationSessionRef.current;
      if (!session || session.tool !== current.activeTool) {
        session = new CreationSession(current.activeTool);
        creationSessionRef.current = session;
      }
      if (definition.gannScaleConstraint && definition.gannFamily && session.points[0]) {
        const defaults = resolveDrawingCreationDefaults(
          current.activeTool,
          current.drawingToolPreferences.toolDefaults[current.activeTool],
          current.drawColor,
        );
        const config = resolveGannConfig(defaults.gann, definition.gannFamily);
        if (config.scaleLock) {
          point = constrainGannAnchor(
            session.points[0],
            point,
            config.priceBarRatio,
            current.adapterContext,
          );
        }
      }
      if (event.shiftKey && definition.angleConstraint === "45-degree" && session.points[0]) {
        point = constrainPointTo45Degrees(session.points[0], point, toX, toY);
      }
      const canDragCreate =
        definition.creationMode === "pointer-continuous" ||
        (definition.creationMode === "two-point" && session.points.length === 0);
      if (canDragCreate) {
        dragActiveRef.current = true;
        freezeChartRef.current?.(true);
        if (definition.creationMode === "two-point") {
          creationDragRef.current = createCreationDragState(
            event.pointerId,
            event.clientX,
            event.clientY,
          );
        }
      }
      const downOutcome = session.pointerDown({
        point,
        clientX: event.clientX,
        clientY: event.clientY,
        timeStamp: event.timeStamp,
      });
      if (downOutcome.kind === "commit") {
        creationReleaseGuardRef.current = event.pointerId;
      }
      applyCreationOutcome(downOutcome);
    };

    const applyCreationMove = (event: PointerEvent) => {
      if (machineRef.current.state !== "Drawing") return;
      const session = creationSessionRef.current;
      const raw = fromEvent(event);
      const rawPoint = raw ? withPointerPressure(raw, event) : null;
      if (!session || !rawPoint) return;
      let point = session.definition.magnetEligible
        ? snapPointRef.current?.(rawPoint, session.tool, event) ?? rawPoint
        : rawPoint;
      if (
        session.definition.gannScaleConstraint &&
        session.definition.gannFamily &&
        session.points[0]
      ) {
        const current = getState();
        const defaults = resolveDrawingCreationDefaults(
          session.tool,
          current.drawingToolPreferences.toolDefaults[session.tool],
          current.drawColor,
        );
        const config = resolveGannConfig(defaults.gann, session.definition.gannFamily);
        if (config.scaleLock) {
          point = constrainGannAnchor(
            session.points[0],
            point,
            config.priceBarRatio,
            current.adapterContext,
          );
        }
      }
      if (event.shiftKey && session.definition.angleConstraint === "45-degree" && session.points[0]) {
        point = constrainPointTo45Degrees(session.points[0], point, toX, toY);
      }
      applyCreationOutcome(session.pointerMove(point));
    };
    const creationMoves = new PointerFrameCoalescer<PointerEvent>(applyCreationMove);
    creationMoveCoalescerRef.current = creationMoves;

    const handleMove = (event: PointerEvent) => {
      if (creationReleaseGuardRef.current != null) return;
      if (machineRef.current.state !== "Drawing") return;
      const session = creationSessionRef.current;
      if (!session) return;
      const dragState = creationDragRef.current;
      if (
        session.definition.creationMode === "two-point" &&
        dragState &&
        dragState.pointerId === event.pointerId
      ) {
        const advancedDragState = advanceCreationDrag(dragState, event);
        if (advancedDragState !== dragState) {
          creationDragRef.current = advancedDragState;
        }
        if (advancedDragState.dragged) {
          dragActiveRef.current = true;
          freezeChartRef.current?.(true);
          event.preventDefault();
          event.stopPropagation();
        }
      }
      if (!isOverCanvas(event, canvas)) return;
      if (session.definition.creationMode !== "pointer-continuous") {
        creationMoves.push(latestPointerSample(event));
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const accepted: Point[] = [];
      let previous = session.points[session.points.length - 1];
      for (const sample of coalescedPointerSamples(event)) {
        const raw = fromEvent(sample);
        const rawPoint = raw ? withPointerPressure(raw, sample) : null;
        if (!rawPoint) continue;
        const point = session.definition.magnetEligible
          ? snapPointRef.current?.(rawPoint, session.tool, sample) ?? rawPoint
          : rawPoint;
        if (!shouldRecordContinuousPoint(previous, point, toX, toY)) continue;
        accepted.push(point);
        previous = point;
      }
      if (accepted.length > 0) {
        applyCreationOutcome(session.pointerMoveBatch(accepted));
      }
    };

    const handleUp = (event: PointerEvent) => {
      if (creationReleaseGuardRef.current === event.pointerId) {
        creationReleaseGuardRef.current = null;
        return;
      }
      if (machineRef.current.state !== "Drawing") return;
      const session = creationSessionRef.current;
      if (!session) return;

      const dragState = creationDragRef.current;
      const samePointer =
        dragState?.pointerId === event.pointerId ||
        activePointerIdRef.current == null ||
        activePointerIdRef.current === event.pointerId;
      if (
        session.definition.creationMode === "two-point" &&
        dragState?.dragged &&
        samePointer
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        // A queued preview must not run after the commit and resurrect the
        // rubber band. Apply the exact release location synchronously first.
        creationMoveCoalescerRef.current?.cancel();
        applyCreationMove(event);
        const anchors = machineRef.current.anchors;
        const finalPoint = anchors[anchors.length - 1];
        if (finalPoint) {
          applyCreationOutcome(session.pointerUp(finalPoint, true));
        } else {
          reset();
        }
        return;
      }

      if (session.definition.creationMode !== "pointer-continuous") {
        // A stationary first click is intentionally left open for the existing
        // click-click gesture. Release capture and chart freeze, but preserve
        // the CreationSession so the next pointerdown supplies anchor two.
        if (samePointer) {
          event.preventDefault();
          event.stopPropagation();
          releaseCapture();
          pointerClaimedRef.current = false;
          dragActiveRef.current = false;
          freezeChartRef.current?.(false);
          creationDragRef.current = null;
        }
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const raw = fromEvent(event);
      const rawPoint = raw ? withPointerPressure(raw, event) : null;
      const point = rawPoint && session.definition.magnetEligible
        ? snapPointRef.current?.(rawPoint, session.tool, event) ?? rawPoint
        : rawPoint;
      const previous = session.points[session.points.length - 1];
      const accept = !!point && shouldRecordContinuousPoint(previous, point, toX, toY);
      applyCreationOutcome(session.pointerUp(point ?? undefined, accept));
    };

    const handleCancel = () => {
      creationReleaseGuardRef.current = null;
      if (machineRef.current.state !== "Drawing") return;
      const session = creationSessionRef.current;
      if (session) applyCreationOutcome(session.cancel());
      else reset();
    };

    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerup", handleUp, true);
    document.addEventListener("pointercancel", handleCancel, true);
    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointercancel", handleCancel, true);
      creationMoves.cancel();
      if (creationMoveCoalescerRef.current === creationMoves) {
        creationMoveCoalescerRef.current = null;
      }
      if (machineRef.current.state === "Drawing") {
        creationSessionRef.current?.cancel();
        reset();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Cursor mode ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleDown = (e: PointerEvent) => {
      // One active pointer owns the transform transaction. A second touch must
      // not replace its capture target/session while the first is still down.
      if (machineRef.current.state !== "Idle" || activePointerIdRef.current != null) return;
      const cur = getState();
      const modeInteraction = getDrawingToolManifestEntry(
        cur.activeTool,
      ).modeInteraction;
      if (!modeInteraction || modeInteraction === "pass-through") return;
      // Ignore clicks that land on the floating drawing settings toolbar /
      // its popovers — they must not deselect the drawing or start a drag.
      if (isOverDrawingUI(e)) return;
      if (!canvas || !isOverCanvas(e, canvas)) return;
      const p = fromEvent(e);
      if (!p || !cur.ctxReady) return;
      if (modeInteraction === "erase") {
        if (cur.drawingsLocked || e.button !== 0) return;
        const drawing = eraseSessionRef.current.pick(cur.drawings, p);
        if (!drawing || drawing.locked) return;
        e.preventDefault();
        e.stopPropagation();
        if (executeCommand) {
          executeCommand(new DeleteDrawingCommand(addDrawing, removeDrawing, drawing));
        } else {
          removeDrawing(drawing.id);
        }
        selectDrawing(null);
        scheduleRedrawRef.current();
        return;
      }
      const hit = hitTest(cur.drawings, p, toX, toY, {
        selectedDrawingIds: cur.selectedDrawingIds,
        pointerType: e.pointerType,
      });
      const outcomes = selectionSessionRef.current.pointerDown({
        hit,
        clientX: e.clientX,
        clientY: e.clientY,
        timeStamp: e.timeStamp,
        button: e.button,
        toggleSelection: e.ctrlKey || e.metaKey,
        drawingsLocked: cur.drawingsLocked,
        selectedDrawingIds: cur.selectedDrawingIds,
        drawings: cur.drawings,
      });

      for (const outcome of outcomes) {
        if (outcome.kind === "toggle") {
          toggleSelectDrawing(outcome.drawingId);
          continue;
        }
        if (outcome.kind === "select") {
          selectDrawing(outcome.drawingId);
          continue;
        }
        if (outcome.kind === "open-settings") {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
          suppressNativeDoubleClickUntilRef.current = e.timeStamp + 500;
          openDrawingSettingsRef.current?.(outcome.drawingId);
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        activePointerIdRef.current = e.pointerId;
        pointerClaimedRef.current = true;
        dragActiveRef.current = true;
        capturePointer(e, canvas);
        freezeChartRef.current?.(true);

        const transformSession = new TransformSession({
          drawing: outcome.drawing,
          dragStart: p,
          anchorIndex: outcome.anchorIndex,
          mode: outcome.mode,
          selectedDrawings: outcome.selectedDrawings,
          adapterContext: cur.adapterContext,
        });
        transformSessionRef.current = transformSession;
        originalGannRef.current = outcome.drawing.gann;
        originalResolvedTradeRef.current =
          outcome.drawing.tradeStatus === "tp_hit" ||
          outcome.drawing.tradeStatus === "sl_hit"
            ? {
                drawingId: outcome.drawing.id,
                tradeStatus: outcome.drawing.tradeStatus,
                hitTime: outcome.drawing.hitTime,
                hitPrice: outcome.drawing.hitPrice,
              }
            : null;
        drawingIdRef.current = outcome.drawing.id;
        livePointsWorkRef.current.clear();
        livePointsRef.current = null;
        cancelHoverFrame();

        transition({
          state: outcome.mode === "move" ? "MovingDrawing" : "ResizingHandle",
          drawingId: outcome.drawing.id,
          drawingTool: outcome.drawing.tool,
          dragAnchor: outcome.anchorIndex,
          dragStart: p,
          dragOrig: transformSession.primaryOriginal,
          multiDragOrig: new Map(transformSession.multiOriginals),
        });
      }
    };

    const applyDragMove = (e: PointerEvent) => {
      const m = machineRef.current;
      if (
        (m.state !== "MovingDrawing" && m.state !== "ResizingHandle") ||
        !transformSessionRef.current ||
        (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current)
      ) {
        return;
      }
      const rawPoint = fromEvent(e);
      if (!rawPoint) return;
      const session = transformSessionRef.current;
      const definition = getDrawingToolManifestEntry(session.tool);
      // A constrained ratio belongs only to the current sample. Releasing Shift
      // before pointer-up must not commit a ratio captured by an earlier frame.
      pendingGannRatioRef.current = null;
      let p = definition.magnetEligible && snapPointRef.current
        ? session.pointerAdjustedForSnap(rawPoint, (point) =>
          snapPointRef.current!(point, session.tool, e),
        )
        : rawPoint;
      if (e.shiftKey && session.mode === "move") {
        p = constrainMovePointerToAxis(session.dragStart, p, toX, toY);
      }
      if (
        definition.gannScaleConstraint === "price-bar-ratio" &&
        definition.gannFamily &&
        session.mode === "resize" &&
        !session.isMulti &&
        session.primaryOriginal.length === 2
      ) {
        const current = getState();
        const drawing = current.drawings.find((item) => item.id === session.drawingId);
        const constrained = drawing
          ? constrainGannResize(
            drawing,
            definition.gannFamily,
            session.primaryOriginal,
            session.anchorIndex,
            p,
            current.adapterContext,
            e.shiftKey,
          )
          : null;
        if (constrained && drawing) {
          p = constrained.point;
          if (e.shiftKey) {
            pendingGannRatioRef.current = {
              drawingId: drawing.id,
              gann: constrained.gann,
            };
          }
        }
      }
      if (
        e.shiftKey &&
        definition.angleConstraint === "45-degree" &&
        definition.handleProfile === "raw-points" &&
        session.mode === "resize" &&
        session.primaryOriginal.length === 2
      ) {
        const opposite = session.primaryOriginal[session.anchorIndex === 0 ? 1 : 0];
        if (opposite) p = constrainPointTo45Degrees(opposite, p, toX, toY);
      }
      const multiMap = livePointsWorkRef.current;
      multiMap.clear();
      for (const [id, points] of session.update(p)) {
        multiMap.set(id, points);
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
        if (activePointerIdRef.current == null || e.pointerId === activePointerIdRef.current) {
          dragMoves.push(latestPointerSample(e));
        }
        return;
      }
      // The drawing-mode listener owns preview input. Avoid duplicate state,
      // layout and hit-test work in this sibling document listener.
      if (m.state !== "Idle") return;
      // Hover
      if (!canvas || !isOverCanvas(e, canvas)) {
        cancelHoverFrame();
        if (hoveredIdRef.current !== null) {
          hoveredIdRef.current = null;
          scheduleRedrawRef.current();
        }
        return;
      }
      const cur = getState();
      if (
        getDrawingToolManifestEntry(cur.activeTool).modeInteraction !==
        "selection"
      ) return;
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
            getDrawingToolManifestEntry(state.activeTool).modeInteraction !==
              "selection"
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
          const hit = hitTest(state.drawings, hp, toX, toY, {
            selectedDrawingIds: state.selectedDrawingIds,
            pointerType: event.pointerType,
          });
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
      const pointerMatches =
        activePointerIdRef.current == null || e.pointerId === activePointerIdRef.current;
      if (
        (m.state === "MovingDrawing" || m.state === "ResizingHandle") &&
        !pointerMatches
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Always release the chart-event block on any pointer release, even if the
      // machine never reached a drag state, so the blocker can never get stuck.
      dragActiveRef.current = false;

      if (
        (m.state === "MovingDrawing" || m.state === "ResizingHandle") &&
        pointerMatches
      ) {
        e.preventDefault();
        e.stopPropagation();
        dragMoves.flush(e);
        const multiMap = livePointsRef.current;
        if (multiMap && multiMap.size > 0) {
          const session = transformSessionRef.current;
          const changes: DrawingMoveChange[] = [];
          for (const [id, pts] of multiMap) {
            const pendingGann = pendingGannRatioRef.current;
            const hasGannChange = pendingGann?.drawingId === id;
            if (!session?.hasChanged(id, pts) && !hasGannChange) continue;
            const orig = session?.originalPointsFor(id);
            if (!orig) continue;
            const resolvedTrade =
              originalResolvedTradeRef.current?.drawingId === id
                ? originalResolvedTradeRef.current
                : null;
            changes.push({
              id,
              newPatch: {
                points: pts,
                ...(hasGannChange ? { gann: pendingGann?.gann } : {}),
                ...(resolvedTrade
                  ? {
                      tradeStatus: undefined,
                      hitTime: undefined,
                      hitPrice: undefined,
                    }
                  : {}),
              },
              oldPatch: {
                points: orig,
                ...(hasGannChange ? { gann: originalGannRef.current } : {}),
                ...(resolvedTrade
                  ? {
                      tradeStatus: resolvedTrade.tradeStatus,
                      hitTime: resolvedTrade.hitTime,
                      hitPrice: resolvedTrade.hitPrice,
                    }
                  : {}),
              },
            });
          }
          if (changes.length > 0) {
            commitMoves(changes);
          }
        }
        releaseCapture();
        livePointsRef.current = null;
        livePointsWorkRef.current.clear();
        drawingIdRef.current = null;
        reset();
      }
    };

    const handlePointerCancel = (e: PointerEvent) => {
      const state = machineRef.current.state;
      if (state !== "MovingDrawing" && state !== "ResizingHandle") return;
      if (activePointerIdRef.current != null && e.pointerId !== activePointerIdRef.current) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dragMoves.cancel();
      reset();
    };

    const handleCtx = (e: MouseEvent) => {
      const m = machineRef.current;
      const cur = getState();
      if (isOverDrawingUI(e)) return;
      if (!canvas || !isOverCanvas(e, canvas)) return;
      if (m.state === "Drawing") {
        e.preventDefault();
        // Right-click finishes an in-progress freeform draw (else cancels).
        const session = creationSessionRef.current;
        if (session) applyCreationOutcome(session.finish());
        else reset();
        return;
      }
      const p = fromEvent(e as unknown as PointerEvent);
      if (!p) return;
      const hit = hitTest(cur.drawings, p, toX, toY, {
        selectedDrawingIds: cur.selectedDrawingIds,
        pointerType: "mouse",
      });
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ id: hit.drawing.id, x: e.clientX, y: e.clientY });
      }
    };

    // Settings open on the second pointerdown so the interaction manager can
    // arbitrate before a drag begins. Consume the matching native dblclick too,
    // otherwise lightweight-charts can also reset/zoom the viewport afterward.
    const handleNativeDoubleClick = (e: MouseEvent) => {
      const suppressUntil = suppressNativeDoubleClickUntilRef.current;
      if (suppressUntil <= 0 || e.timeStamp > suppressUntil) return;
      suppressNativeDoubleClickUntilRef.current = 0;
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    };

    // While a body-move / handle-resize drag is in progress, swallow the raw
    // mouse / touch / wheel events in the capture phase so they never reach
    // lightweight-charts' own listeners (which pan & scale the view). This is
    // what actually stops the "view jump": LWC reacts to mousedown/mousemove,
    // and the drawing canvas being pointerEvents:"none" means those events would
    // otherwise flow straight to the chart underneath.
    const blockChartEvent = (e: Event) => {
      if (!dragActiveRef.current) return;
      if (e.cancelable) e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    };

    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("pointermove", handleMove, true);
    document.addEventListener("pointerup", handleUp, true);
    document.addEventListener("pointercancel", handlePointerCancel, true);
    document.addEventListener("pointerleave", handleUp, true);
    document.addEventListener("contextmenu", handleCtx, true);
    document.addEventListener("dblclick", handleNativeDoubleClick, true);
    document.addEventListener("mousedown", blockChartEvent, true);
    document.addEventListener("mousemove", blockChartEvent, true);
    document.addEventListener("wheel", blockChartEvent, true);
    document.addEventListener("touchstart", blockChartEvent, {
      capture: true,
      passive: false,
    });
    document.addEventListener("touchmove", blockChartEvent, {
      capture: true,
      passive: false,
    });
    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointermove", handleMove, true);
      document.removeEventListener("pointerup", handleUp, true);
      document.removeEventListener("pointercancel", handlePointerCancel, true);
      document.removeEventListener("pointerleave", handleUp, true);
      document.removeEventListener("contextmenu", handleCtx, true);
      document.removeEventListener("dblclick", handleNativeDoubleClick, true);
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
      const state = machineRef.current.state;
      if (state === "MovingDrawing" || state === "ResizingHandle") reset();
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
        const session = creationSessionRef.current;
        if (machineRef.current.state === "Drawing" && session) {
          applyCreationOutcome(session.cancel());
        } else {
          reset();
        }
        setActiveTool("crosshair");
        return;
      }
      if (e.key === "a" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        selectAll?.();
        return;
      }

      const nudgeDirection: DrawingNudgeDirection | undefined = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      }[e.key] as DrawingNudgeDirection | undefined;
      if (
        nudgeDirection &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        machineRef.current.state === "Idle" &&
        tag !== "BUTTON" &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        const current = getState();
        const selectedIds = current.selectedDrawingIds.size > 0
          ? current.selectedDrawingIds
          : current.selectedDrawingId
            ? new Set([current.selectedDrawingId])
            : new Set<string>();
        const changes: DrawingMoveChange[] = current.drawings
          .filter((drawing) =>
            selectedIds.has(drawing.id) &&
            !current.drawingsLocked &&
            !drawing.locked
          )
          .flatMap((drawing) => {
            const points = nudgeDrawingPoints(
              drawing.points,
              nudgeDirection,
              current.adapterContext,
            );
            const changed = drawing.points.some((point, index) =>
              point.time !== points[index]?.time ||
              point.price !== points[index]?.price
            );
            return changed
              ? [{
                  id: drawing.id,
                  oldPatch: { points: drawing.points },
                  newPatch: { points },
                }]
              : [];
          });
        if (changes.length > 0) {
          e.preventDefault();
          commitMoves(changes);
          scheduleRedrawRef.current();
        }
        return;
      }

      // Multi-delete
      if ((e.key === "Delete" || e.key === "Backspace") && executeCommand) {
        const selIds = getState().selectedDrawingIds;
        const selected = getState().drawings.filter((drawing) => selIds.has(drawing.id));
        if (selected.length > 0) {
          e.preventDefault();
          executeCommand(new DeleteDrawingsCommand(
            addDrawing,
            removeDrawing,
            selected,
            () => selectDrawing(null),
            () => undefined,
          ));
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
    commitMoves,
    selectDrawing,
    getState,
    applyCreationOutcome,
  ]);

  const activeDefinition = getDrawingToolManifestEntry(getState().activeTool);
  const dm = activeDefinition.persistent || activeDefinition.modeInteraction === "erase";
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
  const r = getFrameClientRect(canvas);
  return (
    e.clientX >= r.left &&
    e.clientX <= r.right &&
    e.clientY >= r.top &&
    e.clientY <= r.bottom
  );
}
