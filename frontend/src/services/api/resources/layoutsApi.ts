import { deleteJson, getJson, postJson, putJson } from "../client";
import type { Drawing, IndicatorConfig } from "@/types";
import type {
  ChartLayoutPreset,
  ChartPaneState,
  ReplayLayoutMode,
} from "@/store/replayLayoutStore";
import type { BottomTab } from "@/store/uiStore";

export interface SavedLayoutState {
  version: 1;
  /** Stable drawing scope identity; legacy layouts fall back to backend layout id. */
  drawingContextId?: string;
  chartLayoutPreset: ChartLayoutPreset;
  replayLayoutMode: ReplayLayoutMode;
  /** Per-pane markets are retained even while a smaller arrangement hides them. */
  chartPanes?: ChartPaneState[];
  activeChartSlot?: number;
  indicators: IndicatorConfig[];
  drawings: Drawing[];
  panels: {
    sizes: { left: number; right: number; bottom: number };
    rightOpen: boolean;
    bottomOpen: boolean;
    bottomTab: BottomTab;
  };
}

export interface BackendLayout {
  id: string;
  name: string;
  symbol?: string;
  timeframe?: string;
  state: SavedLayoutState;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LayoutWrite {
  name: string;
  symbol: string;
  timeframe: string;
  state: SavedLayoutState;
  isDefault: boolean;
}

export function listLayouts(): Promise<BackendLayout[]> {
  return getJson<BackendLayout[]>("layouts");
}

export function createLayout(payload: LayoutWrite): Promise<BackendLayout> {
  return postJson<BackendLayout>("layouts", payload);
}

export function updateLayout(
  id: string,
  payload: LayoutWrite,
): Promise<BackendLayout> {
  return putJson<BackendLayout>(`layouts/${encodeURIComponent(id)}`, payload);
}

export async function deleteLayout(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`layouts/${encodeURIComponent(id)}`);
}
