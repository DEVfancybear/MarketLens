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

export interface ChartSymbolDropPreview {
  slot: number;
  symbol: string;
}

export interface PersistedChartWorkspaceLayout {
  version: 1;
  chartLayoutPreset: ChartLayoutPreset;
  replayLayoutMode: ReplayLayoutMode;
  chartPanes: ChartPaneState[];
  activeChartSlot: number;
  /** Alert presentation ownership is layout-specific, while alert evaluation remains account-wide. */
  alertChartOwners: Record<string, string>;
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

function isChartLayoutPreset(value: unknown): value is ChartLayoutPreset {
  return (
    value === "single" ||
    value === "two_horizontal" ||
    value === "two_vertical" ||
    value === "grid_2x2"
  );
}

function normalizeAlertChartOwners(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const owners: Record<string, string> = {};
  for (const [alertId, chartId] of Object.entries(value)) {
    const normalizedAlertId = alertId.trim();
    const normalizedChartId =
      typeof chartId === "string" ? chartId.trim() : "";
    if (normalizedAlertId && normalizedChartId) {
      owners[normalizedAlertId] = normalizedChartId;
    }
  }
  return owners;
}

function normalizeAlertChartOwnersForPanes(
  value: unknown,
  panes: readonly ChartPaneState[],
): Record<string, string> {
  const paneIds = new Set(panes.map((pane) => pane.id));
  return Object.fromEntries(
    Object.entries(normalizeAlertChartOwners(value)).filter(([, chartId]) =>
      paneIds.has(chartId),
    ),
  );
}

export function normalizePersistedChartWorkspaceLayout(
  value: unknown,
  fallback: ActiveChartSelection,
): PersistedChartWorkspaceLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Partial<PersistedChartWorkspaceLayout>;
  if (source.version !== 1 || !isChartLayoutPreset(source.chartLayoutPreset)) {
    return null;
  }
  const chartLayoutPreset = source.chartLayoutPreset;
  const visible = visibleChartSlots(chartLayoutPreset);
  const requestedActive = Number.isInteger(source.activeChartSlot)
    ? Number(source.activeChartSlot)
    : 0;
  const activeChartSlot = visible.includes(requestedActive)
    ? requestedActive
    : visible[0] ?? 0;
  const chartPanes = initializePanesForPreset(
    normalizeChartPanes(source.chartPanes, fallback),
    chartLayoutPreset,
    activeChartSlot,
  );
  return {
    version: 1,
    chartLayoutPreset,
    replayLayoutMode:
      source.replayLayoutMode === "all_charts" && chartLayoutPreset !== "single"
        ? "all_charts"
        : "single_chart",
    chartPanes,
    activeChartSlot,
    alertChartOwners: normalizeAlertChartOwnersForPanes(
      source.alertChartOwners,
      chartPanes,
    ),
  };
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
export const chartSymbolDropPreviewAtom = atom<ChartSymbolDropPreview | null>(null);
export const alertChartOwnersAtom = atom<Record<string, string>>({});

/** Return the anonymous/local workspace to the same one-chart baseline as TradingView. */
export const resetChartLayoutStateAtom = atom(null, (_get, set) => {
  set(chartLayoutPresetAtom, "single");
  set(replayLayoutModeAtom, "single_chart");
  set(chartPanesAtom, createInitialChartPanes());
  set(activeChartSlotAtom, 0);
  set(chartSymbolDropPreviewAtom, null);
  set(alertChartOwnersAtom, {});
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

export const dropSymbolOnChartPaneAtom = atom(
  null,
  (
    get,
    set,
    input: {
      slot: number;
      selection: ActiveChartSelection;
    },
  ) => {
    if (!visibleChartSlots(get(chartLayoutPresetAtom)).includes(input.slot)) return;
    set(
      chartPanesAtom,
      updatePaneSelection(get(chartPanesAtom), input.slot, input.selection),
    );
    set(activeChartSlotAtom, input.slot);
    set(chartSymbolDropPreviewAtom, null);
  },
);

export const setAlertChartOwnerAtom = atom(
  null,
  (
    get,
    set,
    input: {
      alertId: string;
      chartId?: string | null;
    },
  ) => {
    const alertId = input.alertId.trim();
    if (!alertId) return;
    const next = { ...get(alertChartOwnersAtom) };
    const chartId = input.chartId?.trim();
    if (chartId) next[alertId] = chartId;
    else delete next[alertId];
    set(alertChartOwnersAtom, next);
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
    if (preset === "single") {
      set(replayLayoutModeAtom, "single_chart");
    }
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
      alertChartOwners?: Record<string, string>;
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
    set(
      alertChartOwnersAtom,
      normalizeAlertChartOwnersForPanes(input.alertChartOwners, panes),
    );
    set(chartSymbolDropPreviewAtom, null);
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
 * Preserve layout slots for both Replay scopes. A single-chart session must
 * remain pinned to the pane where it was created when another pane is focused.
 */
export function replayTracksForBackend(
  _mode: ReplayLayoutMode,
  tracks: ReadonlyArray<{
    slot: number;
    symbol: string;
    chartTimeframe: string;
    required?: boolean;
  }>,
) {
  return tracks.map((track) => ({
    ...track,
    slot: track.slot,
  }));
}
