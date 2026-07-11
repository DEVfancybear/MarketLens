"use client";

import { atom, type Getter } from "jotai";
import { TIMEFRAMES, type Timeframe } from "@/types";
import {
  applySavedChartLayoutAtom,
  drawingsAtom,
  indicatorsAtom,
  symbolAtom,
  timeframeAtom,
} from "./chartStore";
import {
  applySavedPanelLayoutAtom,
  bottomOpenAtom,
  bottomTabAtom,
  panelsAtom,
  rightOpenAtom,
} from "./uiStore";
import {
  chartLayoutPresetAtom,
  replayLayoutModeAtom,
  setChartLayoutPresetAtom,
  setReplayLayoutModeAtom,
} from "./replayLayoutStore";
import {
  createLayout,
  deleteLayout,
  updateLayout,
  type BackendLayout,
  type LayoutWrite,
  type SavedLayoutState,
} from "@/services/api/resources/layoutsApi";

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

function capture(get: Getter): SavedLayoutState {
  return {
    version: 1,
    chartLayoutPreset: get(chartLayoutPresetAtom),
    replayLayoutMode: get(replayLayoutModeAtom),
    indicators: structuredClone(get(indicatorsAtom)),
    drawings: structuredClone(get(drawingsAtom)),
    panels: {
      sizes: { ...get(panelsAtom) },
      rightOpen: get(rightOpenAtom),
      bottomOpen: get(bottomOpenAtom),
      bottomTab: get(bottomTabAtom),
    },
  };
}

function writeFor(get: Getter, name: string, isDefault: boolean): LayoutWrite {
  return {
    name,
    symbol: get(symbolAtom),
    timeframe: get(timeframeAtom),
    state: capture(get),
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
  set(setChartLayoutPresetAtom, state.chartLayoutPreset);
  set(setReplayLayoutModeAtom, state.replayLayoutMode);
  set(applySavedPanelLayoutAtom, state.panels);
  set(applySavedChartLayoutAtom, {
    symbol: layout.symbol,
    timeframe: validTimeframe(layout.timeframe) ? layout.timeframe : undefined,
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
    const item = await createLayout(writeFor(get, input.name, input.isDefault === true));
    const current = input.isDefault
      ? get(layoutsAtom).map((row) => ({ ...row, isDefault: false }))
      : get(layoutsAtom);
    set(layoutsAtom, sortLayouts([...current, item]));
    set(activeLayoutIdAtom, item.id);
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
  set(layoutsAtom, get(layoutsAtom).filter((item) => item.id !== id));
  set(activeLayoutIdAtom, null);
});
