"use client";

import type { Timeframe } from "@/types";
import {
  createInitialChartPanes,
  normalizePersistedChartWorkspaceLayout,
  updatePaneSelection,
  type PersistedChartWorkspaceLayout,
} from "./replayLayoutStore";

export const MAX_CHART_TASKS = 12;
export const CHART_TASK_DRAG_THRESHOLD_PX = 5;

export interface ChartTask {
  id: string;
  drawingContextId: string;
  workspace: PersistedChartWorkspaceLayout;
  activeLayoutId: string | null;
}

export interface ChartTaskTabsDocument {
  version: 1;
  revision: number;
  activeTaskId: string;
  tasks: ChartTask[];
}

export interface ChartTaskIdPair {
  taskId: string;
  drawingContextId: string;
}

export type ChartTaskDropEdge = "before" | "after";

export function createInitialChartTaskTabs(
  selection: { symbol: string; timeframe: Timeframe },
  ids: ChartTaskIdPair = {
    taskId: "chart-task-initial",
    drawingContextId: "chart-task-scope-initial",
  },
): ChartTaskTabsDocument {
  const task: ChartTask = {
    id: ids.taskId,
    drawingContextId: ids.drawingContextId,
    workspace: createTaskWorkspace(selection),
    activeLayoutId: null,
  };
  return {
    version: 1,
    revision: 0,
    activeTaskId: task.id,
    tasks: [task],
  };
}

export function normalizeChartTaskTabsDocument(
  value: unknown,
  selection: { symbol: string; timeframe: Timeframe },
): ChartTaskTabsDocument {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tasks)) {
    return createInitialChartTaskTabs(selection);
  }

  const usedTaskIds = new Set<string>();
  const usedDrawingContexts = new Set<string>();
  const tasks: ChartTask[] = [];
  for (const candidate of value.tasks) {
    if (tasks.length >= MAX_CHART_TASKS || !isRecord(candidate)) break;
    const id = normalizeId(candidate.id);
    const drawingContextId = normalizeId(candidate.drawingContextId);
    const workspace = normalizePersistedChartWorkspaceLayout(
      candidate.workspace,
      selection,
    );
    if (
      !id ||
      !drawingContextId ||
      usedTaskIds.has(id) ||
      usedDrawingContexts.has(drawingContextId) ||
      !workspace
    ) {
      continue;
    }
    usedTaskIds.add(id);
    usedDrawingContexts.add(drawingContextId);
    tasks.push({
      id,
      drawingContextId,
      workspace,
      activeLayoutId:
        candidate.activeLayoutId === null
          ? null
          : normalizeId(candidate.activeLayoutId) || null,
    });
  }

  if (tasks.length === 0) return createInitialChartTaskTabs(selection);
  const requestedActive = normalizeId(value.activeTaskId);
  return {
    version: 1,
    revision:
      Number.isInteger(value.revision) && Number(value.revision) >= 0
        ? Number(value.revision)
        : 0,
    activeTaskId: tasks.some((task) => task.id === requestedActive)
      ? requestedActive
      : tasks[0]!.id,
    tasks,
  };
}

export function addChartTask(
  document: ChartTaskTabsDocument,
  selection: { symbol: string; timeframe: Timeframe },
  ids: ChartTaskIdPair,
): ChartTaskTabsDocument {
  const taskId = normalizeId(ids.taskId);
  const drawingContextId = normalizeId(ids.drawingContextId);
  if (
    document.tasks.length >= MAX_CHART_TASKS ||
    !taskId ||
    !drawingContextId ||
    document.tasks.some(
      (task) =>
        task.id === taskId || task.drawingContextId === drawingContextId,
    )
  ) {
    return document;
  }
  const activeIndex = document.tasks.findIndex(
    (task) => task.id === document.activeTaskId,
  );
  const insertionIndex = activeIndex < 0 ? document.tasks.length : activeIndex + 1;
  const task: ChartTask = {
    id: taskId,
    drawingContextId,
    workspace: createTaskWorkspace(selection),
    activeLayoutId: null,
  };
  const tasks = [...document.tasks];
  tasks.splice(insertionIndex, 0, task);
  return { ...document, activeTaskId: task.id, tasks };
}

export function activateChartTask(
  document: ChartTaskTabsDocument,
  taskId: string,
): ChartTaskTabsDocument {
  if (
    taskId === document.activeTaskId ||
    !document.tasks.some((task) => task.id === taskId)
  ) {
    return document;
  }
  return { ...document, activeTaskId: taskId };
}

export function updateChartTask(
  document: ChartTaskTabsDocument,
  taskId: string,
  workspace: PersistedChartWorkspaceLayout,
  activeLayoutId: string | null,
): ChartTaskTabsDocument {
  const index = document.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) return document;
  const current = document.tasks[index]!;
  if (
    current.workspace === workspace &&
    current.activeLayoutId === activeLayoutId
  ) {
    return document;
  }
  const tasks = [...document.tasks];
  tasks[index] = { ...current, workspace, activeLayoutId };
  return { ...document, tasks };
}

export function closeChartTask(
  document: ChartTaskTabsDocument,
  taskId: string,
): ChartTaskTabsDocument {
  if (document.tasks.length <= 1) return document;
  const index = document.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) return document;
  const tasks = document.tasks.filter((task) => task.id !== taskId);
  const activeTaskId =
    document.activeTaskId === taskId
      ? (tasks[index] ?? tasks[index - 1])!.id
      : document.activeTaskId;
  return { ...document, activeTaskId, tasks };
}

export function moveChartTask(
  document: ChartTaskTabsDocument,
  sourceId: string,
  targetId: string,
  edge: ChartTaskDropEdge,
): ChartTaskTabsDocument {
  if (sourceId === targetId) return document;
  const sourceIndex = document.tasks.findIndex((task) => task.id === sourceId);
  const targetIndex = document.tasks.findIndex((task) => task.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return document;

  const tasks = [...document.tasks];
  const [source] = tasks.splice(sourceIndex, 1);
  const targetAfterRemoval = tasks.findIndex((task) => task.id === targetId);
  tasks.splice(targetAfterRemoval + (edge === "after" ? 1 : 0), 0, source!);
  if (tasks.every((task, index) => task === document.tasks[index])) {
    return document;
  }
  return { ...document, tasks };
}

export function chartTaskDropEdge(
  pointerX: number,
  targetLeft: number,
  targetWidth: number,
): ChartTaskDropEdge {
  return pointerX < targetLeft + targetWidth / 2 ? "before" : "after";
}

export function shouldActivateChartTaskDrag(
  startX: number,
  startY: number,
  pointerX: number,
  pointerY: number,
): boolean {
  return Math.hypot(pointerX - startX, pointerY - startY) > CHART_TASK_DRAG_THRESHOLD_PX;
}

function createTaskWorkspace(selection: {
  symbol: string;
  timeframe: Timeframe;
}): PersistedChartWorkspaceLayout {
  return {
    version: 1,
    chartLayoutPreset: "single",
    replayLayoutMode: "single_chart",
    chartPanes: updatePaneSelection(createInitialChartPanes(), 0, selection),
    activeChartSlot: 0,
    alertChartOwners: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id && id.length <= 128 ? id : "";
}
