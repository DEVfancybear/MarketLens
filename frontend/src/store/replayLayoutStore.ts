"use client";

import { atom } from "jotai";
import { TIMEFRAMES, type Timeframe } from "../types";

export type ChartLayoutPreset =
  | "single"
  | "two_horizontal"
  | "two_vertical"
  | "grid_2x2";
export type ReplayLayoutMode = "single_chart" | "all_charts";

export interface ChartPaneState {
  /** Stable identity used by saved layouts and per-chart drawing scopes. */
  id: string;
  slot: number;
  symbol: string;
  timeframe: Timeframe;
  /** Hidden panes are retained; this distinguishes them from never-created panes. */
  initialized: boolean;
}

export interface ActiveChartSelection {
  symbol: string;
  timeframe: Timeframe;
}

export const MAX_CHART_PANES = 4;
const DEFAULT_TIMEFRAME: Timeframe = "15m";

function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && TIMEFRAMES.includes(value as Timeframe);
}

function paneId(slot: number): string {
  return slot === 0 ? "main" : `chart-${slot + 1}`;
}

export function createInitialChartPanes(): ChartPaneState[] {
  return Array.from({ length: MAX_CHART_PANES }, (_, slot) => ({
    id: paneId(slot),
    slot,
    symbol: "",
    timeframe: DEFAULT_TIMEFRAME,
    initialized: false,
  }));
}

export function chartCountForPreset(preset: ChartLayoutPreset): number {
  if (preset === "grid_2x2") return 4;
  if (preset === "two_horizontal" || preset === "two_vertical") return 2;
  return 1;
}

export function visibleChartSlots(preset: ChartLayoutPreset): number[] {
  return Array.from({ length: chartCountForPreset(preset) }, (_, slot) => slot);
}

export function normalizeChartPanes(
  panes: readonly Partial<ChartPaneState>[] | null | undefined,
  fallback: ActiveChartSelection,
): ChartPaneState[] {
  const sourceRows = Array.isArray(panes) ? panes : [];
  const bySlot = new Map(
    sourceRows
      .filter(
        (pane): pane is Partial<ChartPaneState> =>
          Boolean(pane) &&
          typeof pane === "object" &&
          Number.isInteger((pane as Partial<ChartPaneState>).slot),
      )
      .map((pane) => [Number(pane.slot), pane]),
  );
  const usedIds = new Set<string>();

  return Array.from({ length: MAX_CHART_PANES }, (_, slot) => {
    const source = bySlot.get(slot);
    const requestedId =
      typeof source?.id === "string" ? source.id.trim() : "";
    let id = requestedId && !usedIds.has(requestedId) ? requestedId : paneId(slot);
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${paneId(slot)}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    const sourceSymbol =
      typeof source?.symbol === "string" ? source.symbol.trim() : "";
    const symbol = sourceSymbol || fallback.symbol.trim();
    const timeframe = isTimeframe(source?.timeframe)
      ? source.timeframe
      : fallback.timeframe;
    return {
      id,
      slot,
      symbol,
      timeframe,
      initialized:
        typeof source?.initialized === "boolean"
          ? source.initialized
          : Boolean(symbol),
    };
  });
}

export function updatePaneSelection(
  panes: readonly ChartPaneState[],
  slot: number,
  selection: ActiveChartSelection,
): ChartPaneState[] {
  const normalized = normalizeChartPanes(panes, selection);
  return normalized.map((pane) =>
    pane.slot === slot
      ? {
          ...pane,
          symbol: selection.symbol.trim(),
          timeframe: selection.timeframe,
          initialized: Boolean(selection.symbol.trim()),
        }
      : pane,
  );
}

export function initializePanesForPreset(
  panes: readonly ChartPaneState[],
  preset: ChartLayoutPreset,
  activeSlot: number,
): ChartPaneState[] {
  const normalized = normalizeChartPanes(panes, {
    symbol: "",
    timeframe: DEFAULT_TIMEFRAME,
  });
  const active = normalized.find((pane) => pane.slot === activeSlot) ?? normalized[0]!;
  const source = active.initialized
    ? active
    : normalized.find((pane) => pane.initialized) ?? active;
  const visible = new Set(visibleChartSlots(preset));

  return normalized.map((pane) =>
    visible.has(pane.slot) && !pane.initialized
      ? {
          ...pane,
          symbol: source.symbol,
          timeframe: source.timeframe,
          initialized: source.initialized,
        }
      : pane,
  );
}

export const chartLayoutPresetAtom = atom<ChartLayoutPreset>("single");
export const replayLayoutModeAtom = atom<ReplayLayoutMode>("single_chart");
export const chartPanesAtom = atom<ChartPaneState[]>(createInitialChartPanes());
export const activeChartSlotAtom = atom(0);

/** Return the anonymous/local workspace to the same one-chart baseline as TradingView. */
export const resetChartLayoutStateAtom = atom(null, (_get, set) => {
  set(chartLayoutPresetAtom, "single");
  set(replayLayoutModeAtom, "single_chart");
  set(chartPanesAtom, createInitialChartPanes());
  set(activeChartSlotAtom, 0);
});

export const setActiveChartSlotAtom = atom(
  null,
  (get, set, requestedSlot: number) => {
    const visible = visibleChartSlots(get(chartLayoutPresetAtom));
    if (visible.includes(requestedSlot)) set(activeChartSlotAtom, requestedSlot);
  },
);

export const syncActiveChartPaneAtom = atom(
  null,
  (get, set, selection: ActiveChartSelection) => {
    const updated = updatePaneSelection(
      get(chartPanesAtom),
      get(activeChartSlotAtom),
      selection,
    );
    set(
      chartPanesAtom,
      initializePanesForPreset(
        updated,
        get(chartLayoutPresetAtom),
        get(activeChartSlotAtom),
      ),
    );
  },
);

export const setChartLayoutPresetAtom = atom(
  null,
  (get, set, preset: ChartLayoutPreset) => {
    const panes = initializePanesForPreset(
      get(chartPanesAtom),
      preset,
      get(activeChartSlotAtom),
    );
    const visible = visibleChartSlots(preset);
    set(chartPanesAtom, panes);
    if (!visible.includes(get(activeChartSlotAtom))) {
      set(activeChartSlotAtom, visible[0] ?? 0);
    }
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

export const restoreChartLayoutStateAtom = atom(
  null,
  (
    _get,
    set,
    input: {
      preset: ChartLayoutPreset;
      replayMode: ReplayLayoutMode;
      panes?: readonly Partial<ChartPaneState>[];
      activeSlot?: number;
      fallback: ActiveChartSelection;
    },
  ) => {
    const visible = visibleChartSlots(input.preset);
    const requestedActive = Number.isInteger(input.activeSlot)
      ? Number(input.activeSlot)
      : 0;
    const activeSlot = visible.includes(requestedActive)
      ? requestedActive
      : visible[0] ?? 0;
    const panes = initializePanesForPreset(
      normalizeChartPanes(input.panes, input.fallback),
      input.preset,
      activeSlot,
    );
    set(chartPanesAtom, panes);
    set(activeChartSlotAtom, activeSlot);
    set(chartLayoutPresetAtom, input.preset);
    set(
      replayLayoutModeAtom,
      input.replayMode === "all_charts" && input.preset !== "single"
        ? "all_charts"
        : "single_chart",
    );
  },
);

export function replayTracksForLayout(
  mode: ReplayLayoutMode,
  preset: ChartLayoutPreset,
  active: { symbol: string; chartTimeframe: string; slot?: number },
  panes: readonly ChartPaneState[] = [],
  requestedActiveSlot = active.slot ?? 0,
) {
  const visible = visibleChartSlots(preset);
  const activeSlot = visible.includes(requestedActiveSlot)
    ? requestedActiveSlot
    : visible[0] ?? 0;
  const slots = mode === "all_charts" ? visible : [activeSlot];

  return slots.map((slot) => {
    const pane = panes.find((candidate) => candidate.slot === slot);
    const useActiveSelection = slot === activeSlot;
    return {
      slot,
      symbol:
        !useActiveSelection && pane?.initialized && pane.symbol
          ? pane.symbol
          : active.symbol,
      chartTimeframe:
        !useActiveSelection && pane?.initialized && pane.timeframe
          ? pane.timeframe
          : active.chartTimeframe,
    };
  });
}

/**
 * The backend requires track slots to be contiguous from zero. In
 * `single_chart` mode the visible pane can be slot 2/3 in the UI, but it is
 * still represented by the single backend track at slot zero. The client maps
 * that track back to `activeChartSlotAtom` when rendering.
 */
export function replayTracksForBackend(
  mode: ReplayLayoutMode,
  tracks: ReadonlyArray<{ slot: number; symbol: string; chartTimeframe: string }>,
) {
  return tracks.map((track, index) => ({
    ...track,
    slot: mode === "single_chart" ? 0 : index,
  }));
}
