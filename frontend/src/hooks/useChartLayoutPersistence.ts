"use client";

import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
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

/** Autosaves the current multi-chart projection into the account settings queue. */
export function useChartLayoutPersistence(): void {
  const backendSession = useAtomValue(backendSessionAtom);
  const workspaceReady = useAtomValue(workspaceReadyAtom);
  const preset = useAtomValue(chartLayoutPresetAtom);
  const replayMode = useAtomValue(replayLayoutModeAtom);
  const panes = useAtomValue(chartPanesAtom);
  const activeSlot = useAtomValue(activeChartSlotAtom);
  const owners = useAtomValue(alertChartOwnersAtom);
  const symbol = useAtomValue(symbolAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const persistWorkspace = useSetAtom(persistChartWorkspaceLayoutAtom);

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
