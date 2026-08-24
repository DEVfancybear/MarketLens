"use client";

import { atom, type Getter, type Setter } from "jotai";
import { uid } from "@/utils/id";
import {
  activeToolAtom,
  crosshairAtom,
  drawingChartIdAtom,
  drawingLayoutIdAtom,
  editingDrawingIdAtom,
  editingIndicatorIdAtom,
  selectedDrawingIdAtom,
  selectedDrawingIdsAtom,
  setDrawingLayoutContextAtom,
  setSymbolAtom,
  setTimeframeAtom,
  symbolAtom,
  timeframeAtom,
} from "./chartStore";
import { activeLayoutIdAtom } from "./layoutStore";
import {
  activeChartSlotAtom,
  alertChartOwnersAtom,
  chartLayoutPresetAtom,
  chartPanesAtom,
  replayLayoutModeAtom,
  restoreChartLayoutStateAtom,
  updatePaneSelection,
  type ChartPaneState,
  type PersistedChartWorkspaceLayout,
} from "./replayLayoutStore";
import {
  activateChartTask,
  addChartTask,
  closeChartTask,
  createInitialChartTaskTabs,
  moveChartTask,
  normalizeChartTaskTabsDocument,
  updateChartTask,
  type ChartTask,
  type ChartTaskDropEdge,
  type ChartTaskTabsDocument,
} from "./chartTaskTabsStore";

export type ChartTaskTabsSyncStatus =
  | "idle"
  | "pending"
  | "saved"
  | "conflict"
  | "error";

const initialDocument = createInitialChartTaskTabs({
  symbol: "",
  timeframe: "15m",
});

export const chartTaskTabsAtom = atom<ChartTaskTabsDocument>(initialDocument);
export const chartTaskTabsReadyAtom = atom(false);
export const chartTaskTabsDirtyAtom = atom(false);
export const chartTaskTabsSyncStatusAtom = atom<ChartTaskTabsSyncStatus>("idle");

function captureWorkspace(get: Getter): PersistedChartWorkspaceLayout {
  const activeSlot = get(activeChartSlotAtom);
  return {
    version: 1,
    chartLayoutPreset: get(chartLayoutPresetAtom),
    replayLayoutMode: get(replayLayoutModeAtom),
    chartPanes: structuredClone(
      updatePaneSelection(get(chartPanesAtom), activeSlot, {
        symbol: get(symbolAtom),
        timeframe: get(timeframeAtom),
      }),
    ),
    activeChartSlot: activeSlot,
    alertChartOwners: { ...get(alertChartOwnersAtom) },
  };
}

function captureActiveTask(get: Getter): ChartTaskTabsDocument {
  const document = get(chartTaskTabsAtom);
  const active = document.tasks.find(
    (task) => task.id === document.activeTaskId,
  );
  if (!active) return document;
  const workspace = captureWorkspace(get);
  const activeLayoutId = get(activeLayoutIdAtom);
  if (
    active.activeLayoutId === activeLayoutId &&
    JSON.stringify(active.workspace) === JSON.stringify(workspace)
  ) {
    return document;
  }
  return updateChartTask(document, active.id, workspace, activeLayoutId);
}

function activePane(task: ChartTask): ChartPaneState {
  return (
    task.workspace.chartPanes.find(
      (pane) => pane.slot === task.workspace.activeChartSlot,
    ) ?? task.workspace.chartPanes[0]!
  );
}

function applyTask(get: Getter, set: Setter, task: ChartTask): ChartPaneState {
  const pane = activePane(task);
  const fallback = {
    symbol: pane.symbol || get(symbolAtom),
    timeframe: pane.timeframe || get(timeframeAtom),
  };
  set(activeToolAtom, "crosshair");
  set(selectedDrawingIdAtom, null);
  set(selectedDrawingIdsAtom, new Set());
  set(editingDrawingIdAtom, null);
  set(editingIndicatorIdAtom, null);
  set(crosshairAtom, null);
  set(restoreChartLayoutStateAtom, {
    preset: task.workspace.chartLayoutPreset,
    replayMode: task.workspace.replayLayoutMode,
    panes: task.workspace.chartPanes,
    activeSlot: task.workspace.activeChartSlot,
    fallback,
    alertChartOwners: task.workspace.alertChartOwners,
  });
  set(setDrawingLayoutContextAtom, {
    layoutId: task.drawingContextId,
    chartId: pane.id || get(drawingChartIdAtom),
  });
  if (pane.symbol) set(setSymbolAtom, pane.symbol);
  set(setTimeframeAtom, pane.timeframe);
  set(activeLayoutIdAtom, task.activeLayoutId);
  return pane;
}

function setLocalDocument(
  set: Setter,
  document: ChartTaskTabsDocument,
): void {
  set(chartTaskTabsAtom, document);
  set(chartTaskTabsDirtyAtom, true);
  set(chartTaskTabsSyncStatusAtom, "pending");
}

function hasPersistedTasks(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Array.isArray((value as { tasks?: unknown }).tasks) &&
      ((value as { tasks: unknown[] }).tasks.length > 0),
  );
}

export const hydrateChartTaskTabsAtom = atom(
  null,
  (get, set, value: unknown): ChartPaneState => {
    const selection = {
      symbol: get(symbolAtom),
      timeframe: get(timeframeAtom),
    };
    let document: ChartTaskTabsDocument;
    let migrated = false;
    if (hasPersistedTasks(value)) {
      document = normalizeChartTaskTabsDocument(value, selection);
    } else {
      const drawingContextId = get(drawingLayoutIdAtom) || uid("chart-task-scope");
      document = createInitialChartTaskTabs(selection, {
        taskId: uid("chart-task"),
        drawingContextId,
      });
      document = updateChartTask(
        document,
        document.activeTaskId,
        captureWorkspace(get),
        get(activeLayoutIdAtom),
      );
      migrated = true;
    }
    set(chartTaskTabsAtom, document);
    set(chartTaskTabsReadyAtom, true);
    set(chartTaskTabsDirtyAtom, migrated);
    set(chartTaskTabsSyncStatusAtom, migrated ? "pending" : "idle");
    return applyTask(get, set, document.tasks.find(
      (task) => task.id === document.activeTaskId,
    )!);
  },
);

export const resetChartTaskTabsAtom = atom(null, (get, set) => {
  const document = createInitialChartTaskTabs(
    { symbol: get(symbolAtom), timeframe: get(timeframeAtom) },
    {
      taskId: uid("chart-task"),
      drawingContextId: get(drawingLayoutIdAtom) || uid("chart-task-scope"),
    },
  );
  set(chartTaskTabsAtom, document);
  set(chartTaskTabsReadyAtom, true);
  set(chartTaskTabsDirtyAtom, false);
  set(chartTaskTabsSyncStatusAtom, "idle");
});

export const captureActiveChartTaskAtom = atom(null, (get, set) => {
  if (!get(chartTaskTabsReadyAtom)) return false;
  const current = get(chartTaskTabsAtom);
  const next = captureActiveTask(get);
  if (next === current) return false;
  setLocalDocument(set, next);
  return true;
});

export const addNewChartTaskAtom = atom(null, (get, set) => {
  const captured = captureActiveTask(get);
  const next = addChartTask(
    captured,
    { symbol: get(symbolAtom), timeframe: get(timeframeAtom) },
    {
      taskId: uid("chart-task"),
      drawingContextId: uid("chart-task-scope"),
    },
  );
  if (next === captured) return false;
  setLocalDocument(set, next);
  applyTask(get, set, next.tasks.find((task) => task.id === next.activeTaskId)!);
  return true;
});

export const activateChartTaskAtom = atom(null, (get, set, taskId: string) => {
  const captured = captureActiveTask(get);
  const next = activateChartTask(captured, taskId);
  if (next === captured) return false;
  setLocalDocument(set, next);
  applyTask(get, set, next.tasks.find((task) => task.id === taskId)!);
  return true;
});

export const closeChartTaskAtom = atom(null, (get, set, taskId: string) => {
  const captured = captureActiveTask(get);
  const next = closeChartTask(captured, taskId);
  if (next === captured) return false;
  const activeChanged = next.activeTaskId !== captured.activeTaskId;
  setLocalDocument(set, next);
  if (activeChanged) {
    applyTask(
      get,
      set,
      next.tasks.find((task) => task.id === next.activeTaskId)!,
    );
  }
  return true;
});

export const moveChartTaskAtom = atom(
  null,
  (
    get,
    set,
    input: { sourceId: string; targetId: string; edge: ChartTaskDropEdge },
  ) => {
    const captured = captureActiveTask(get);
    const next = moveChartTask(
      captured,
      input.sourceId,
      input.targetId,
      input.edge,
    );
    if (next === captured) return false;
    setLocalDocument(set, next);
    return true;
  },
);

export const acknowledgeChartTaskTabsAtom = atom(
  null,
  (get, set, saved: ChartTaskTabsDocument) => {
    const current = get(chartTaskTabsAtom);
    const contentMatches =
      current.activeTaskId === saved.activeTaskId &&
      JSON.stringify(current.tasks) === JSON.stringify(saved.tasks);
    set(
      chartTaskTabsAtom,
      contentMatches ? saved : { ...current, revision: saved.revision },
    );
    set(chartTaskTabsDirtyAtom, !contentMatches);
    set(chartTaskTabsSyncStatusAtom, contentMatches ? "saved" : "pending");
  },
);

export const adoptConflictedChartTaskTabsAtom = atom(
  null,
  (get, set, server: ChartTaskTabsDocument) => {
    const document = normalizeChartTaskTabsDocument(server, {
      symbol: get(symbolAtom),
      timeframe: get(timeframeAtom),
    });
    set(chartTaskTabsAtom, document);
    set(chartTaskTabsDirtyAtom, false);
    set(chartTaskTabsSyncStatusAtom, "conflict");
    applyTask(
      get,
      set,
      document.tasks.find((task) => task.id === document.activeTaskId)!,
    );
  },
);

export const restorePendingChartTaskTabsAtom = atom(
  null,
  (get, set, pending: ChartTaskTabsDocument) => {
    const document = normalizeChartTaskTabsDocument(pending, {
      symbol: get(symbolAtom),
      timeframe: get(timeframeAtom),
    });
    setLocalDocument(set, document);
    applyTask(
      get,
      set,
      document.tasks.find((task) => task.id === document.activeTaskId)!,
    );
  },
);

export const failChartTaskTabsSyncAtom = atom(null, (_get, set) => {
  set(chartTaskTabsSyncStatusAtom, "error");
});
