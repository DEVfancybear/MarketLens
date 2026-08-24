"use client";

import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Cloud, CloudAlert, Plus, X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { exitReplaySession } from "@/services/replay/replaySocket";
import { replayClientStore } from "@/store/replayClientStore";
import {
  activateChartTaskAtom,
  addNewChartTaskAtom,
  chartTaskTabsAtom,
  chartTaskTabsSyncStatusAtom,
  closeChartTaskAtom,
  moveChartTaskAtom,
} from "@/store/chartTaskTabsRuntimeStore";
import {
  MAX_CHART_TASKS,
  chartTaskDropEdge,
  shouldActivateChartTaskDrag,
  type ChartTask,
  type ChartTaskDropEdge,
} from "@/store/chartTaskTabsStore";
import { cn } from "@/utils/cn";

interface DropTarget {
  id: string;
  edge: ChartTaskDropEdge;
}

interface DragSession {
  pointerId: number;
  sourceId: string;
  startX: number;
  startY: number;
  active: boolean;
}

const AUTO_SCROLL_EDGE_PX = 36;
const AUTO_SCROLL_STEP_PX = 12;

export function ChartTaskTabs() {
  const { t } = useI18n();
  const document = useAtomValue(chartTaskTabsAtom);
  const syncStatus = useAtomValue(chartTaskTabsSyncStatusAtom);
  const activateTask = useSetAtom(activateChartTaskAtom);
  const addTask = useSetAtom(addNewChartTaskAtom);
  const closeTask = useSetAtom(closeChartTaskAtom);
  const moveTask = useSetAtom(moveChartTaskAtom);
  const tabListRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollDirectionRef = useRef<-1 | 0 | 1>(0);
  const autoScrollFrameRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const taskName = (task: ChartTask, index: number) => {
    const pane =
      task.workspace.chartPanes.find(
        (candidate) => candidate.slot === task.workspace.activeChartSlot,
      ) ?? task.workspace.chartPanes[0];
    const symbol = pane?.symbol || `Chart ${index + 1}`;
    return t("chartTasks.tab", {
      symbol,
      timeframe: pane?.timeframe ?? "15m",
    });
  };

  const resolveDropTarget = (
    clientX: number,
    clientY: number,
    sourceId: string,
  ): DropTarget | null => {
    const element = documentFromPoint(clientX, clientY)?.closest<HTMLElement>(
      "[data-chart-task-id]",
    );
    const targetId = element?.dataset.chartTaskId;
    if (!element || !targetId || targetId === sourceId) return null;
    const bounds = element.getBoundingClientRect();
    return {
      id: targetId,
      edge: chartTaskDropEdge(clientX, bounds.left, bounds.width),
    };
  };

  const stopAutoScroll = () => {
    autoScrollDirectionRef.current = 0;
    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
  };

  const runAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) return;
    const tick = () => {
      const direction = autoScrollDirectionRef.current;
      const list = tabListRef.current;
      const session = dragSessionRef.current;
      const point = lastPointerRef.current;
      if (!direction || !list || !session || !point) {
        autoScrollFrameRef.current = null;
        return;
      }
      list.scrollLeft += direction * AUTO_SCROLL_STEP_PX;
      const nextTarget = resolveDropTarget(point.x, point.y, session.sourceId);
      dropTargetRef.current = nextTarget;
      setDropTarget(nextTarget);
      autoScrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    autoScrollFrameRef.current = window.requestAnimationFrame(tick);
  };

  const updateAutoScroll = (clientX: number) => {
    const list = tabListRef.current;
    if (!list) return;
    const bounds = list.getBoundingClientRect();
    const direction: -1 | 0 | 1 =
      clientX < bounds.left + AUTO_SCROLL_EDGE_PX
        ? -1
        : clientX > bounds.right - AUTO_SCROLL_EDGE_PX
          ? 1
          : 0;
    autoScrollDirectionRef.current = direction;
    if (direction) runAutoScroll();
    else stopAutoScroll();
  };

  const clearDragState = () => {
    stopAutoScroll();
    const cleanup = dragCleanupRef.current;
    dragCleanupRef.current = null;
    cleanup?.();
    dragSessionRef.current = null;
    dropTargetRef.current = null;
    lastPointerRef.current = null;
    setDraggedId(null);
    setDragOffsetX(0);
    setDropTarget(null);
  };

  const finishDrag = (
    pointerId: number,
    commit: boolean,
    point?: { x: number; y: number },
  ) => {
    const session = dragSessionRef.current;
    if (!session || session.pointerId !== pointerId) return;
    const finalTarget =
      commit && point
        ? resolveDropTarget(point.x, point.y, session.sourceId)
        : null;
    if (commit && session.active && finalTarget) {
      moveTask({
        sourceId: session.sourceId,
        targetId: finalTarget.id,
        edge: finalTarget.edge,
      });
    }
    if (session.active) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 0);
    }
    clearDragState();
  };

  const startDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    taskId: string,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("[data-chart-task-no-drag]")
    ) {
      return;
    }
    clearDragState();
    dragSessionRef.current = {
      pointerId: event.pointerId,
      sourceId: taskId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const session = dragSessionRef.current;
      if (!session || session.pointerId !== pointerEvent.pointerId) return;
      if (
        !session.active &&
        !shouldActivateChartTaskDrag(
          session.startX,
          session.startY,
          pointerEvent.clientX,
          pointerEvent.clientY,
        )
      ) {
        return;
      }
      if (!session.active) {
        session.active = true;
        setDraggedId(session.sourceId);
      }
      pointerEvent.preventDefault();
      lastPointerRef.current = {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      };
      setDragOffsetX(pointerEvent.clientX - session.startX);
      const nextTarget = resolveDropTarget(
        pointerEvent.clientX,
        pointerEvent.clientY,
        session.sourceId,
      );
      dropTargetRef.current = nextTarget;
      setDropTarget(nextTarget);
      updateAutoScroll(pointerEvent.clientX);
    };
    const onPointerUp = (pointerEvent: PointerEvent) =>
      finishDrag(pointerEvent.pointerId, true, {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      });
    const onPointerCancel = (pointerEvent: PointerEvent) =>
      finishDrag(pointerEvent.pointerId, false);
    const onWindowBlur = () => {
      const session = dragSessionRef.current;
      if (session) finishDrag(session.pointerId, false);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onWindowBlur);
  };

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      stopAutoScroll();
    },
    [],
  );

  const exitReplayIfNeeded = async () => {
    if (replayClientStore.getState().snapshot) await exitReplaySession();
  };

  const selectTask = async (taskId: string) => {
    if (suppressNextClickRef.current || taskId === document.activeTaskId) return;
    await exitReplayIfNeeded();
    activateTask(taskId);
  };

  const createTask = async () => {
    if (document.tasks.length >= MAX_CHART_TASKS) return;
    await exitReplayIfNeeded();
    addTask();
  };

  const removeTask = async (taskId: string) => {
    if (document.tasks.length <= 1) return;
    const closingIndex = document.tasks.findIndex((task) => task.id === taskId);
    const focusId =
      taskId === document.activeTaskId
        ? (document.tasks[closingIndex + 1] ?? document.tasks[closingIndex - 1])?.id
        : document.activeTaskId;
    if (taskId === document.activeTaskId) await exitReplayIfNeeded();
    closeTask(taskId);
    requestAnimationFrame(() => {
      if (focusId) tabRefs.current.get(focusId)?.focus();
    });
  };

  const onTabKeyDown = async (
    event: React.KeyboardEvent<HTMLButtonElement>,
    task: ChartTask,
    index: number,
  ) => {
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (event.shiftKey && direction) {
      event.preventDefault();
      const target = document.tasks[index + direction];
      if (!target) return;
      const name = taskName(task, index);
      moveTask({
        sourceId: task.id,
        targetId: target.id,
        edge: direction < 0 ? "before" : "after",
      });
      setAnnouncement(
        t(direction < 0 ? "chartTasks.movedLeft" : "chartTasks.movedRight", {
          name,
        }),
      );
      requestAnimationFrame(() => tabRefs.current.get(task.id)?.focus());
      return;
    }

    let targetIndex: number | null = null;
    if (direction) targetIndex = (index + direction + document.tasks.length) % document.tasks.length;
    if (event.key === "Home") targetIndex = 0;
    if (event.key === "End") targetIndex = document.tasks.length - 1;
    if (targetIndex === null) return;
    event.preventDefault();
    const target = document.tasks[targetIndex]!;
    await selectTask(target.id);
    tabRefs.current.get(target.id)?.focus();
  };

  const syncLabel = t(`chartTasks.sync.${syncStatus}`);
  const atLimit = document.tasks.length >= MAX_CHART_TASKS;

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-terminal-border bg-terminal-panel-2/70">
      <div
        ref={tabListRef}
        role="tablist"
        aria-label={t("chartTasks.aria")}
        className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
      >
        {document.tasks.map((task, index) => {
          const active = task.id === document.activeTaskId;
          const dragging = task.id === draggedId;
          const name = taskName(task, index);
          const target = dropTarget?.id === task.id ? dropTarget.edge : null;
          return (
            <div
              key={task.id}
              data-chart-task-id={task.id}
              onPointerDown={(event) => startDrag(event, task.id)}
              className={cn(
                "relative flex min-w-32 max-w-52 shrink-0 items-center border-r border-terminal-border/70",
                active ? "bg-(--chart-bg)" : "bg-terminal-panel-2/50 hover:bg-terminal-hover/70",
                dragging &&
                  "pointer-events-none z-20 cursor-grabbing opacity-75 shadow-terminal",
              )}
              style={
                dragging
                  ? {
                      transform: `translate3d(${dragOffsetX}px, 0, 0)`,
                      touchAction: "none",
                    }
                  : { touchAction: "pan-y" }
              }
            >
              {target && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-y-1 z-30 w-0.5 rounded-full bg-brand",
                    target === "before" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
                  )}
                />
              )}
              <button
                ref={(node) => {
                  if (node) tabRefs.current.set(task.id, node);
                  else tabRefs.current.delete(task.id);
                }}
                id={`chart-task-tab-${task.id}`}
                type="button"
                role="tab"
                tabIndex={active ? 0 : -1}
                aria-selected={active}
                aria-controls="chart-task-panel"
                onClick={() => void selectTask(task.id)}
                onKeyDown={(event) => void onTabKeyDown(event, task, index)}
                className={cn(
                  "min-w-0 flex-1 truncate px-3 text-left text-[10px] font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60",
                  active ? "text-ink" : "text-ink-muted hover:text-ink",
                )}
                title={name}
              >
                {name}
              </button>
              {document.tasks.length > 1 && (
                <button
                  data-chart-task-no-drag
                  type="button"
                  aria-label={t("chartTasks.close", { name })}
                  title={t("chartTasks.close", { name })}
                  onClick={(event) => {
                    event.stopPropagation();
                    void removeTask(task.id);
                  }}
                  className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-faint hover:bg-terminal-hover hover:text-ink focus-ring"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        disabled={atLimit}
        aria-label={atLimit ? t("chartTasks.max", { count: MAX_CHART_TASKS }) : t("chartTasks.add")}
        title={atLimit ? t("chartTasks.max", { count: MAX_CHART_TASKS }) : t("chartTasks.add")}
        onClick={() => void createTask()}
        className="flex w-9 shrink-0 items-center justify-center border-r border-terminal-border text-ink-muted hover:bg-terminal-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 focus-ring"
      >
        <Plus size={14} aria-hidden="true" />
      </button>
      <span
        role="status"
        aria-label={syncLabel}
        title={syncLabel}
        className={cn(
          "flex w-8 shrink-0 items-center justify-center text-ink-faint",
          syncStatus === "error" || syncStatus === "conflict"
            ? "text-warn"
            : syncStatus === "saved"
              ? "text-bull"
              : "text-ink-faint",
        )}
      >
        {syncStatus === "error" || syncStatus === "conflict" ? (
          <CloudAlert size={13} aria-hidden="true" />
        ) : (
          <Cloud size={13} aria-hidden="true" />
        )}
      </span>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}

function documentFromPoint(x: number, y: number): Element | null {
  return typeof document === "undefined" ? null : document.elementFromPoint(x, y);
}
