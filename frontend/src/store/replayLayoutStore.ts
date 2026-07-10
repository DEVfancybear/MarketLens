"use client";

import { atom } from "jotai";

export type ChartLayoutPreset = "single" | "two_horizontal" | "two_vertical" | "grid_2x2";
export type ReplayLayoutMode = "single_chart" | "all_charts";

export const chartLayoutPresetAtom = atom<ChartLayoutPreset>("single");
export const replayLayoutModeAtom = atom<ReplayLayoutMode>("single_chart");

export const setChartLayoutPresetAtom = atom(
  null,
  (_get, set, preset: ChartLayoutPreset) => {
    set(chartLayoutPresetAtom, preset);
    if (preset === "single") set(replayLayoutModeAtom, "single_chart");
  },
);

export const setReplayLayoutModeAtom = atom(
  null,
  (get, set, mode: ReplayLayoutMode) => {
    set(
      replayLayoutModeAtom,
      mode === "all_charts" && get(chartLayoutPresetAtom) !== "single"
        ? "all_charts"
        : "single_chart",
    );
  },
);

export function chartCountForPreset(preset: ChartLayoutPreset): number {
  if (preset === "grid_2x2") return 4;
  if (preset === "two_horizontal" || preset === "two_vertical") return 2;
  return 1;
}

export function replayTracksForLayout(
  mode: ReplayLayoutMode,
  preset: ChartLayoutPreset,
  active: { symbol: string; chartTimeframe: string },
) {
  const count = mode === "all_charts" ? chartCountForPreset(preset) : 1;
  return Array.from({ length: count }, (_, slot) => ({ slot, ...active }));
}
