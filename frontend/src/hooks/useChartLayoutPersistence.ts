"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  authUserAtom,
  backendSessionAtom,
  workspaceReadyAtom,
} from "@/store/authStore";
import {
  persistChartWorkspaceLayoutAtom,
  symbolAtom,
  timeframeAtom,
} from "@/store/chartStore";
import {
  activeChartSlotAtom,
  alertChartOwnersAtom,
  chartLayoutPresetAtom,
  chartPanesAtom,
  replayLayoutModeAtom,
  updatePaneSelection,
  type PersistedChartWorkspaceLayout,
} from "@/store/replayLayoutStore";
import {
  captureActiveChartTaskAtom,
  chartTaskTabsAtom,
  chartTaskTabsDirtyAtom,
  chartTaskTabsReadyAtom,
  restorePendingChartTaskTabsAtom,
} from "@/store/chartTaskTabsRuntimeStore";
import {
  enqueueChartTaskTabs,
  readPendingChartTaskTabs,
  resetChartTaskTabsSync,
} from "@/services/api/chartTaskTabsSyncRuntime";

/** Autosaves the current multi-chart projection into the account settings queue. */
export function useChartLayoutPersistence(): void {
  const backendSession = useAtomValue(backendSessionAtom);
  const user = useAtomValue(authUserAtom);
  const workspaceReady = useAtomValue(workspaceReadyAtom);
  const preset = useAtomValue(chartLayoutPresetAtom);
  const replayMode = useAtomValue(replayLayoutModeAtom);
  const panes = useAtomValue(chartPanesAtom);
  const activeSlot = useAtomValue(activeChartSlotAtom);
  const owners = useAtomValue(alertChartOwnersAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const persistWorkspace = useSetAtom(persistChartWorkspaceLayoutAtom);
  const taskTabs = useAtomValue(chartTaskTabsAtom);
  const taskTabsReady = useAtomValue(chartTaskTabsReadyAtom);
  const taskTabsDirty = useAtomValue(chartTaskTabsDirtyAtom);
  const captureActiveTask = useSetAtom(captureActiveChartTaskAtom);
  const restorePendingTaskTabs = useSetAtom(restorePendingChartTaskTabsAtom);
  const activeSyncUidRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceReady || !taskTabsReady) return;
    captureActiveTask();
  }, [
    activeSlot,
    captureActiveTask,
    owners,
    panes,
    preset,
    replayMode,
    symbol,
    taskTabsReady,
    timeframe,
    workspaceReady,
  ]);

  useEffect(() => {
    if (!backendSession || !workspaceReady || !taskTabsReady || !user) return;
    const pending = readPendingChartTaskTabs(user.uid);
    if (pending) restorePendingTaskTabs(pending);
  }, [
    backendSession,
    restorePendingTaskTabs,
    taskTabsReady,
    user,
    workspaceReady,
  ]);

  useEffect(() => {
    if (
      !backendSession ||
      !workspaceReady ||
      !taskTabsReady ||
      !taskTabsDirty ||
      !user
    ) {
      return;
    }
    enqueueChartTaskTabs(user.uid, taskTabs);
  }, [
    backendSession,
    taskTabs,
    taskTabsDirty,
    taskTabsReady,
    user,
    workspaceReady,
  ]);

  useEffect(() => {
    if (
      user &&
      activeSyncUidRef.current &&
      activeSyncUidRef.current !== user.uid
    ) {
      resetChartTaskTabsSync(activeSyncUidRef.current);
      activeSyncUidRef.current = null;
    }
    if (backendSession && user) {
      activeSyncUidRef.current = user.uid;
      return;
    }
    if (user || !activeSyncUidRef.current) return;
    resetChartTaskTabsSync(activeSyncUidRef.current);
    activeSyncUidRef.current = null;
  }, [backendSession, user]);

  useEffect(() => {
    if (!backendSession || !workspaceReady) return;
    const workspaceLayout: PersistedChartWorkspaceLayout = {
      version: 1,
      chartLayoutPreset: preset,
      replayLayoutMode: replayMode,
      chartPanes: updatePaneSelection(panes, activeSlot, {
        symbol,
        timeframe,
      }),
      activeChartSlot: activeSlot,
      alertChartOwners: { ...owners },
    };
    persistWorkspace(workspaceLayout);
  }, [
    activeSlot,
    backendSession,
    owners,
    panes,
    persistWorkspace,
    preset,
    replayMode,
    symbol,
    timeframe,
    workspaceReady,
  ]);
}
