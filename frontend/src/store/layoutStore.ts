"use client";

import { atom, type Getter } from "jotai";
import { TIMEFRAMES, type Timeframe } from "@/types";
import {
  applySavedChartLayoutAtom,
  adoptDrawingLayoutContextAtom,
  drawingChartIdAtom,
  drawingLayoutIdAtom,
  drawingsAtom,
  indicatorsAtom,
  symbolAtom,
  timeframeAtom,
  setDrawingLayoutContextAtom,
} from "./chartStore";
import {
  applySavedPanelLayoutAtom,
  bottomOpenAtom,
  bottomTabAtom,
  panelsAtom,
  rightOpenAtom,
} from "./uiStore";
import {
  activeChartSlotAtom,
  chartLayoutPresetAtom,
  chartPanesAtom,
  normalizeChartPanes,
  replayLayoutModeAtom,
  restoreChartLayoutStateAtom,
  updatePaneSelection,
  visibleChartSlots,
  type ChartLayoutPreset,
  type ReplayLayoutMode,
} from "./replayLayoutStore";
import {
  createLayout,
  deleteLayout,
  updateLayout,
  type BackendLayout,
  type LayoutWrite,
  type SavedLayoutState,
} from "@/services/api/resources/layoutsApi";
import { rebindDrawingsToSyncContext } from "@/components/chart/drawing/persistence/drawingSyncScope";
import { uid } from "@/utils/id";

export const layoutsAtom = atom<BackendLayout[]>([]);
export const activeLayoutIdAtom = atom<string | null>(null);

function sortLayouts(items: BackendLayout[]): BackendLayout[] {
  return [...items].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

function validTimeframe(value: string | undefined): value is Timeframe {
  return TIMEFRAMES.includes(value as Timeframe);
}

function capture(get: Getter, drawingContextId = get(drawingLayoutIdAtom)): SavedLayoutState {
  const chartId = get(drawingChartIdAtom);
  const symbol = get(symbolAtom);
  const timeframe = get(timeframeAtom);
  const activeChartSlot = get(activeChartSlotAtom);
  return {
    version: 1,
    drawingContextId,
    chartLayoutPreset: get(chartLayoutPresetAtom),
    replayLayoutMode: get(replayLayoutModeAtom),
    chartPanes: structuredClone(
      updatePaneSelection(
        get(chartPanesAtom),
        activeChartSlot,
        { symbol, timeframe },
      ),
    ),
    activeChartSlot,
    indicators: structuredClone(get(indicatorsAtom)),
    drawings: structuredClone(
      rebindDrawingsToSyncContext(get(drawingsAtom), {
        symbol,
        layoutId: drawingContextId,
        chartId,
      }),
    ),
    panels: {
      sizes: { ...get(panelsAtom) },
      rightOpen: get(rightOpenAtom),
      bottomOpen: get(bottomOpenAtom),
      bottomTab: get(bottomTabAtom),
    },
  };
}

function writeFor(
  get: Getter,
  name: string,
  isDefault: boolean,
  drawingContextId = get(drawingLayoutIdAtom),
): LayoutWrite {
  return {
    name,
    symbol: get(symbolAtom),
    timeframe: get(timeframeAtom),
    state: capture(get, drawingContextId),
    isDefault,
  };
}

function replaceLocal(items: BackendLayout[], updated: BackendLayout): BackendLayout[] {
  return sortLayouts(
    items.map((item) => ({
      ...(item.id === updated.id ? updated : item),
      isDefault: updated.isDefault ? item.id === updated.id : item.isDefault,
    })),
  );
}

export const applyRemoteLayoutsAtom = atom(
  null,
  (_get, set, rows: BackendLayout[]) => {
    set(layoutsAtom, sortLayouts(rows));
    set(activeLayoutIdAtom, null);
  },
);

export const loadLayoutAtom = atom(null, (_get, set, layout: BackendLayout) => {
  const state = layout.state;
  if (!state || state.version !== 1) throw new Error("Unsupported layout snapshot");
  const timeframe = validTimeframe(layout.timeframe) ? layout.timeframe : _get(timeframeAtom);
  const fallback = {
    symbol: layout.symbol?.trim() || _get(symbolAtom),
    timeframe,
  };
  const validPresets: ChartLayoutPreset[] = [
    "single",
    "two_horizontal",
    "two_vertical",
    "grid_2x2",
  ];
  const preset = validPresets.includes(state.chartLayoutPreset)
    ? state.chartLayoutPreset
    : "single";
  const replayMode: ReplayLayoutMode =
    state.replayLayoutMode === "all_charts" ? "all_charts" : "single_chart";
  const panes = normalizeChartPanes(state.chartPanes, fallback);
  const visibleSlots = visibleChartSlots(preset);
  const activeChartSlot = visibleSlots.includes(state.activeChartSlot ?? 0)
    ? state.activeChartSlot ?? 0
    : visibleSlots[0] ?? 0;
  const activePane = panes.find((pane) => pane.slot === activeChartSlot) ?? panes[0]!;
  set(restoreChartLayoutStateAtom, {
    preset,
    replayMode,
    panes,
    activeSlot: activeChartSlot,
    fallback,
  });
  set(applySavedPanelLayoutAtom, state.panels);
  set(setDrawingLayoutContextAtom, {
    layoutId: state.drawingContextId || layout.id,
    chartId: activePane.id,
  });
  set(applySavedChartLayoutAtom, {
    symbol: activePane.symbol || fallback.symbol,
    timeframe: activePane.timeframe,
    indicators: state.indicators,
    drawings: state.drawings,
  });
  set(activeLayoutIdAtom, layout.id);
});

export const loadDefaultLayoutAtom = atom(null, (get, set) => {
  const layout = get(layoutsAtom).find((item) => item.isDefault);
  if (layout) set(loadLayoutAtom, layout);
  return Boolean(layout);
});

export const createCurrentLayoutAtom = atom(
  null,
  async (get, set, input: { name: string; isDefault?: boolean }) => {
    const drawingContextId = uid("layout-scope");
    const chartId = get(drawingChartIdAtom);
    const item = await createLayout(
      writeFor(get, input.name, input.isDefault === true, drawingContextId),
    );
    const current = input.isDefault
      ? get(layoutsAtom).map((row) => ({ ...row, isDefault: false }))
      : get(layoutsAtom);
    set(layoutsAtom, sortLayouts([...current, item]));
    set(activeLayoutIdAtom, item.id);
    set(adoptDrawingLayoutContextAtom, { layoutId: drawingContextId, chartId });
    return item;
  },
);

export const overwriteActiveLayoutAtom = atom(null, async (get, set) => {
  const active = get(layoutsAtom).find((item) => item.id === get(activeLayoutIdAtom));
  if (!active) throw new Error("Select a saved layout first");
  const updated = await updateLayout(active.id, writeFor(get, active.name, active.isDefault));
  set(layoutsAtom, replaceLocal(get(layoutsAtom), updated));
  return updated;
});

export const makeActiveLayoutDefaultAtom = atom(null, async (get, set) => {
  const active = get(layoutsAtom).find((item) => item.id === get(activeLayoutIdAtom));
  if (!active) throw new Error("Select a saved layout first");
  const payload: LayoutWrite = {
    name: active.name,
    symbol: active.symbol ?? get(symbolAtom),
    timeframe: active.timeframe ?? get(timeframeAtom),
    state: active.state,
    isDefault: true,
  };
  const updated = await updateLayout(active.id, payload);
  set(layoutsAtom, replaceLocal(get(layoutsAtom), updated));
  return updated;
});

export const deleteActiveLayoutAtom = atom(null, async (get, set) => {
  const id = get(activeLayoutIdAtom);
  if (!id) throw new Error("Select a saved layout first");
  await deleteLayout(id);
  const remaining = sortLayouts(get(layoutsAtom).filter((item) => item.id !== id));
  set(layoutsAtom, remaining);
  const fallback = remaining.find((item) => item.isDefault) ?? remaining[0];
  if (fallback) set(loadLayoutAtom, fallback);
  else set(activeLayoutIdAtom, null);
});
