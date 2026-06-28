"use client";
import { create } from "zustand";
import type {
  Candle,
  Drawing,
  DrawingTool,
  IndicatorConfig,
  IndicatorType,
  Timeframe,
} from "@/types";
import { localStore } from "@/services/storage";
import { uid } from "@/utils/id";
import { defaultIndicator } from "@/services/indicators";

interface ChartState {
  symbol: string;
  timeframe: Timeframe;

  /** Master series for the current symbol+timeframe (full, untruncated). */
  candles: Candle[];
  loading: boolean;

  /** Drawings & indicators (persisted per symbol in localStorage). */
  drawings: Drawing[];
  indicators: IndicatorConfig[];

  activeTool: DrawingTool;
  drawColor: string;
  selectedDrawingId: string | null;
  /** Multi-selection set (includes the singleton selectedDrawingId). */
  selectedDrawingIds: Set<string>;
  /** Global locks (TradingView "Lock all" / "Hide all"). */
  drawingsLocked: boolean;
  drawingsHidden: boolean;
  /** Indicator being edited in the settings dialog. */
  editingIndicatorId: string | null;

  /** Crosshair readout pushed from the chart. */
  crosshair: { time: number; candle: Candle | null } | null;

  setSymbol: (s: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  setCandles: (c: Candle[]) => void;
  setLoading: (v: boolean) => void;

  setActiveTool: (t: DrawingTool) => void;
  setDrawColor: (c: string) => void;
  addDrawing: (d: Drawing) => void;
  updateDrawing: (id: string, patch: Partial<Drawing>) => void;
  removeDrawing: (id: string) => void;
  duplicateDrawing: (id: string) => void;
  selectDrawing: (id: string | null) => void;
  /** Multi-select: add/remove from selection set. */
  toggleSelectDrawing: (id: string) => void;
  /** Select all visible drawings. */
  selectAll: () => void;
  clearDrawings: () => void;
  /** Per-drawing layer & visibility actions. */
  lockDrawing: (id: string) => void;
  hideDrawing: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  /** Global toggles. */
  toggleLockAll: () => void;
  toggleHideAll: () => void;

  addIndicator: (type: IndicatorType) => void;
  /** Add the indicator if no instance of this type exists, otherwise remove it. */
  toggleIndicator: (type: IndicatorType) => void;
  updateIndicator: (id: string, patch: Partial<IndicatorConfig>) => void;
  removeIndicator: (id: string) => void;
  /** Remove every indicator (TradingView "Remove indicators"). */
  clearIndicators: () => void;

  setCrosshair: (c: ChartState["crosshair"]) => void;
  setEditingIndicator: (id: string | null) => void;
  /** Load persisted drawings/indicators from localStorage. Client-only. */
  hydrate: () => void;
}

// Default to a Binance crypto symbol so the chart streams live with no API key.
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_TF: Timeframe = "15m";

function drawingsKey(symbol: string) {
  return `drawings:${symbol}`;
}

export const useChartStore = create<ChartState>((set, get) => ({
  symbol: DEFAULT_SYMBOL,
  timeframe: DEFAULT_TF,
  candles: [],
  loading: false,

  // SSR-safe empty defaults; persisted state loaded in hydrate() on the client.
  drawings: [],
  indicators: [],

  activeTool: "cursor",
  drawColor: "#2962ff",
  selectedDrawingId: null,
  selectedDrawingIds: new Set(),
  drawingsLocked: false,
  drawingsHidden: false,
  editingIndicatorId: null,
  crosshair: null,

  hydrate: () =>
    set({
      drawings: localStore.get<Drawing[]>(drawingsKey(get().symbol), []),
      indicators: localStore.get<IndicatorConfig[]>("indicators", []),
    }),

  setSymbol: (symbol) => {
    if (symbol === get().symbol) return;
    set({
      symbol,
      candles: [],
      loading: true,
      drawings: localStore.get<Drawing[]>(drawingsKey(symbol), []),
      selectedDrawingId: null,
      selectedDrawingIds: new Set(),
    });
  },

  setTimeframe: (timeframe) => {
    if (timeframe === get().timeframe) return;
    set({ timeframe, candles: [], loading: true });
  },

  setCandles: (candles) => set({ candles, loading: false }),
  setLoading: (loading) => set({ loading }),

  setActiveTool: (activeTool) => set({ activeTool }),
  setDrawColor: (drawColor) => set({ drawColor }),

  addDrawing: (d) => {
    const top = get().drawings.reduce((m, x) => Math.max(m, x.zIndex ?? 0), 0);
    const drawing = {
      visible: true,
      locked: false,
      zIndex: top + 1,
      ...d,
      id: d.id || uid("dw"),
      points: d.points ? d.points.map((p) => ({ ...p })) : [],
    };
    const drawings = [...get().drawings, drawing];
    // Single-click tools stay active (TradingView behavior).
    // Two-click tools switch back to cursor after placement.
    const singleClick = [
      "horizontal",
      "horizRay",
      "vertical",
      "crossLine",
      "infoLine",
      "text",
      "emoji",
      "long",
      "short",
    ].includes(d.tool);
    set({
      drawings,
      activeTool: singleClick ? get().activeTool : "cursor",
      selectedDrawingId: drawing.id,
    });
    localStore.set(drawingsKey(get().symbol), drawings);
  },
  updateDrawing: (id, patch) => {
    const drawings = get().drawings.map((d) =>
      d.id === id ? { ...d, ...patch } : d,
    );
    set({ drawings });
    localStore.set(drawingsKey(get().symbol), drawings);
  },
  removeDrawing: (id) => {
    const drawings = get().drawings.filter((d) => d.id !== id);
    set({ drawings, selectedDrawingId: null });
    localStore.set(drawingsKey(get().symbol), drawings);
  },
  duplicateDrawing: (id) => {
    const src = get().drawings.find((d) => d.id === id);
    if (!src) return;
    const top = get().drawings.reduce((m, x) => Math.max(m, x.zIndex ?? 0), 0);
    const copy: Drawing = {
      ...src,
      id: uid("dw"),
      zIndex: top + 1,
      points: src.points.map((p) => ({ ...p })),
    };
    const drawings = [...get().drawings, copy];
    set({ drawings, selectedDrawingId: copy.id });
    localStore.set(drawingsKey(get().symbol), drawings);
  },
  lockDrawing: (id) => {
    const drawings = get().drawings.map((d) =>
      d.id === id ? { ...d, locked: !d.locked } : d,
    );
    set({ drawings });
    localStore.set(drawingsKey(get().symbol), drawings);
  },
  hideDrawing: (id) => {
    const drawings = get().drawings.map((d) =>
      d.id === id ? { ...d, visible: d.visible === false } : d,
    );
    set({ drawings, selectedDrawingId: null });
    localStore.set(drawingsKey(get().symbol), drawings);
  },
  bringToFront: (id) => {
    const top = get().drawings.reduce((m, x) => Math.max(m, x.zIndex ?? 0), 0);
    get().updateDrawing(id, { zIndex: top + 1 });
  },
  sendToBack: (id) => {
    const bottom = get().drawings.reduce(
      (m, x) => Math.min(m, x.zIndex ?? 0),
      0,
    );
    get().updateDrawing(id, { zIndex: bottom - 1 });
  },
  toggleLockAll: () => set((s) => ({ drawingsLocked: !s.drawingsLocked })),
  toggleHideAll: () => set((s) => ({ drawingsHidden: !s.drawingsHidden })),
  selectDrawing: (selectedDrawingId) => {
    set({
      selectedDrawingId,
      selectedDrawingIds: selectedDrawingId
        ? new Set([selectedDrawingId])
        : new Set(),
    });
  },
  toggleSelectDrawing: (id) => {
    const prev = get().selectedDrawingIds;
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({
      selectedDrawingIds: next,
      selectedDrawingId: next.size === 1 ? [...next][0] : null,
    });
  },
  selectAll: () => {
    const ids = new Set(
      get()
        .drawings.filter((d) => d.visible !== false)
        .map((d) => d.id),
    );
    set({ selectedDrawingIds: ids, selectedDrawingId: null });
  },
  clearDrawings: () => {
    set({
      drawings: [],
      selectedDrawingId: null,
      selectedDrawingIds: new Set(),
    });
    localStore.set(drawingsKey(get().symbol), []);
  },

  addIndicator: (type) => {
    const cfg = defaultIndicator(type, uid("ind"));
    const indicators = [...get().indicators, cfg];
    set({ indicators });
    localStore.set("indicators", indicators);
  },
  toggleIndicator: (type) => {
    const current = get().indicators;
    const has = current.some((i) => i.type === type);
    // Off if any instance of this type exists; on otherwise. Always produce a
    // NEW array so subscribers (menu + chart) re-render.
    const indicators = has
      ? current.filter((i) => i.type !== type)
      : [...current, defaultIndicator(type, uid("ind"))];
    set({ indicators });
    localStore.set("indicators", indicators);
  },
  updateIndicator: (id, patch) => {
    const indicators = get().indicators.map((i) =>
      i.id === id ? { ...i, ...patch } : i,
    );
    set({ indicators });
    localStore.set("indicators", indicators);
  },
  removeIndicator: (id) => {
    const indicators = get().indicators.filter((i) => i.id !== id);
    set({ indicators });
    localStore.set("indicators", indicators);
  },
  clearIndicators: () => {
    set({ indicators: [] });
    localStore.set("indicators", []);
  },

  setCrosshair: (crosshair) => set({ crosshair }),
  setEditingIndicator: (editingIndicatorId) => set({ editingIndicatorId }),
}));
