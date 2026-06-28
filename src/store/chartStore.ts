"use client";
import { atom, getDefaultStore } from "jotai";
import { useAtomValue } from "jotai";
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

// Default to a Binance crypto symbol so the chart streams live with no API key.
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_TF: Timeframe = "15m";

function drawingsKey(symbol: string) {
  return `drawings:${symbol}`;
}

const SINGLE_CLICK_TOOLS = new Set<DrawingTool>([
  "horizontal",
  "horizRay",
  "vertical",
  "crossLine",
  "infoLine",
  "text",
  "emoji",
]);

// ---------------------------------------------------------------------------
// Primitive atoms (one per state field)
// ---------------------------------------------------------------------------

export const symbolAtom = atom<string>(DEFAULT_SYMBOL);
export const timeframeAtom = atom<Timeframe>(DEFAULT_TF);
export const candlesAtom = atom<Candle[]>([]);
export const loadingAtom = atom<boolean>(false);
export const drawingsAtom = atom<Drawing[]>([]);
export const indicatorsAtom = atom<IndicatorConfig[]>([]);
export const activeToolAtom = atom<DrawingTool>("cursor");
export const drawColorAtom = atom<string>("#2962ff");
export const selectedDrawingIdAtom = atom<string | null>(null);
export const selectedDrawingIdsAtom = atom<Set<string>>(new Set<string>());
export const drawingsLockedAtom = atom<boolean>(false);
export const drawingsHiddenAtom = atom<boolean>(false);
export const editingIndicatorIdAtom = atom<string | null>(null);
export const crosshairAtom = atom<{
  time: number;
  candle: Candle | null;
} | null>(null);

// ---------------------------------------------------------------------------
// Write atoms (actions) that read / modify multiple atoms
// ---------------------------------------------------------------------------

export const setSymbolAtom = atom(null, (_get, set, symbol: string) => {
  if (symbol === _get(symbolAtom)) return;
  set(symbolAtom, symbol);
  set(candlesAtom, []);
  set(loadingAtom, true);
  set(drawingsAtom, localStore.get<Drawing[]>(drawingsKey(symbol), []));
  set(selectedDrawingIdAtom, null);
  set(selectedDrawingIdsAtom, new Set());
});

export const setTimeframeAtom = atom(
  null,
  (_get, set, timeframe: Timeframe) => {
    if (timeframe === _get(timeframeAtom)) return;
    set(timeframeAtom, timeframe);
    set(candlesAtom, []);
    set(loadingAtom, true);
  },
);

export const setCandlesAtom = atom(null, (_get, set, candles: Candle[]) => {
  set(candlesAtom, candles);
  set(loadingAtom, false);
});

export const setLoadingAtom = atom(null, (_get, set, loading: boolean) => {
  set(loadingAtom, loading);
});

export const setActiveToolAtom = atom(null, (_get, set, t: DrawingTool) => {
  set(activeToolAtom, t);
});

export const setDrawColorAtom = atom(null, (_get, set, c: string) => {
  set(drawColorAtom, c);
});

export const addDrawingAtom = atom(null, (_get, set, d: Drawing) => {
  const top = _get(drawingsAtom).reduce(
    (m, x) => Math.max(m, x.zIndex ?? 0),
    0,
  );
  const drawing: Drawing = {
    visible: true,
    locked: false,
    zIndex: top + 1,
    ...d,
    id: d.id || uid("dw"),
    points: d.points ? d.points.map((p) => ({ ...p })) : [],
  };
  // Long/Short position tools: a single click only gives the entry point.
  // Auto-expand to a TradingView-style 3-point box — points[0]=entry,
  // points[1]={rightEdgeTime, targetPrice}, points[2]={rightEdgeTime, stopPrice}
  // — so the profit/risk zones are immediately visible and draggable.
  if (
    (drawing.tool === "long" || drawing.tool === "short") &&
    drawing.points.length === 1
  ) {
    const entry = drawing.points[0].price;
    const tEntry = drawing.points[0].time;
    const candles = _get(candlesAtom);
    const interval =
      candles.length >= 2
        ? candles[candles.length - 1].time - candles[candles.length - 2].time
        : 3600;
    const tRight = tEntry + interval * 20; // ~20-bar default width
    const risk = 0.01; // 1% default risk
    const rr = 2; // default 1 : 2 reward-to-risk
    const isLong = drawing.tool === "long";
    const target = entry * (1 + (isLong ? risk * rr : -risk * rr));
    const stop = entry * (1 + (isLong ? -risk : risk));
    drawing.points = [
      { time: tEntry, price: entry },
      { time: tRight, price: target },
      { time: tRight, price: stop },
    ];
  }
  const drawings = [..._get(drawingsAtom), drawing];
  // Single-click tools stay active; two-click tools switch back to cursor.
  const singleClick = SINGLE_CLICK_TOOLS.has(d.tool);
  set(drawingsAtom, drawings);
  set(activeToolAtom, singleClick ? _get(activeToolAtom) : "cursor");
  set(selectedDrawingIdAtom, drawing.id);
  localStore.set(drawingsKey(_get(symbolAtom)), drawings);
});

export const updateDrawingAtom = atom(
  null,
  (_get, set, arg: { id: string; patch: Partial<Drawing> }) => {
    const { id, patch } = arg;
    const drawings = _get(drawingsAtom).map((d) =>
      d.id === id ? { ...d, ...patch } : d,
    );
    set(drawingsAtom, drawings);
    localStore.set(drawingsKey(_get(symbolAtom)), drawings);
  },
);

export const removeDrawingAtom = atom(null, (_get, set, id: string) => {
  const drawings = _get(drawingsAtom).filter((d) => d.id !== id);
  set(drawingsAtom, drawings);
  set(selectedDrawingIdAtom, null);
  localStore.set(drawingsKey(_get(symbolAtom)), drawings);
});

export const duplicateDrawingAtom = atom(null, (_get, set, id: string) => {
  const src = _get(drawingsAtom).find((d) => d.id === id);
  if (!src) return;
  const top = _get(drawingsAtom).reduce(
    (m, x) => Math.max(m, x.zIndex ?? 0),
    0,
  );
  const copy: Drawing = {
    ...src,
    id: uid("dw"),
    zIndex: top + 1,
    points: src.points.map((p) => ({ ...p })),
  };
  const drawings = [..._get(drawingsAtom), copy];
  set(drawingsAtom, drawings);
  set(selectedDrawingIdAtom, copy.id);
  localStore.set(drawingsKey(_get(symbolAtom)), drawings);
});

export const lockDrawingAtom = atom(null, (_get, set, id: string) => {
  const drawings = _get(drawingsAtom).map((d) =>
    d.id === id ? { ...d, locked: !d.locked } : d,
  );
  set(drawingsAtom, drawings);
  localStore.set(drawingsKey(_get(symbolAtom)), drawings);
});

export const hideDrawingAtom = atom(null, (_get, set, id: string) => {
  const drawings = _get(drawingsAtom).map((d) =>
    d.id === id ? { ...d, visible: d.visible === false } : d,
  );
  set(drawingsAtom, drawings);
  set(selectedDrawingIdAtom, null);
  localStore.set(drawingsKey(_get(symbolAtom)), drawings);
});

export const bringToFrontAtom = atom(null, (_get, set, id: string) => {
  const top = _get(drawingsAtom).reduce(
    (m, x) => Math.max(m, x.zIndex ?? 0),
    0,
  );
  set(updateDrawingAtom, { id, patch: { zIndex: top + 1 } });
});

export const sendToBackAtom = atom(null, (_get, set, id: string) => {
  const bottom = _get(drawingsAtom).reduce(
    (m, x) => Math.min(m, x.zIndex ?? 0),
    0,
  );
  set(updateDrawingAtom, { id, patch: { zIndex: bottom - 1 } });
});

export const toggleLockAllAtom = atom(null, (_get, set) => {
  set(drawingsLockedAtom, !_get(drawingsLockedAtom));
});

export const toggleHideAllAtom = atom(null, (_get, set) => {
  set(drawingsHiddenAtom, !_get(drawingsHiddenAtom));
});

export const selectDrawingAtom = atom(
  null,
  (_get, set, selectedDrawingId: string | null) => {
    set(selectedDrawingIdAtom, selectedDrawingId);
    set(
      selectedDrawingIdsAtom,
      selectedDrawingId ? new Set([selectedDrawingId]) : new Set(),
    );
  },
);

export const toggleSelectDrawingAtom = atom(null, (_get, set, id: string) => {
  const prev = _get(selectedDrawingIdsAtom);
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  set(selectedDrawingIdsAtom, next);
  set(selectedDrawingIdAtom, next.size === 1 ? [...next][0] : null);
});

export const selectAllAtom = atom(null, (_get, set) => {
  const ids = new Set(
    _get(drawingsAtom)
      .filter((d) => d.visible !== false)
      .map((d) => d.id),
  );
  set(selectedDrawingIdsAtom, ids);
  set(selectedDrawingIdAtom, null);
});

export const clearDrawingsAtom = atom(null, (_get, set) => {
  set(drawingsAtom, []);
  set(selectedDrawingIdAtom, null);
  set(selectedDrawingIdsAtom, new Set());
  localStore.set(drawingsKey(_get(symbolAtom)), []);
});

export const addIndicatorAtom = atom(null, (_get, set, type: IndicatorType) => {
  const cfg = defaultIndicator(type, uid("ind"));
  const indicators = [..._get(indicatorsAtom), cfg];
  set(indicatorsAtom, indicators);
  localStore.set("indicators", indicators);
});

export const toggleIndicatorAtom = atom(
  null,
  (_get, set, type: IndicatorType) => {
    const current = _get(indicatorsAtom);
    const has = current.some((i) => i.type === type);
    const indicators = has
      ? current.filter((i) => i.type !== type)
      : [...current, defaultIndicator(type, uid("ind"))];
    set(indicatorsAtom, indicators);
    localStore.set("indicators", indicators);
  },
);

export const updateIndicatorAtom = atom(
  null,
  (_get, set, arg: { id: string; patch: Partial<IndicatorConfig> }) => {
    const { id, patch } = arg;
    const indicators = _get(indicatorsAtom).map((i) =>
      i.id === id ? { ...i, ...patch } : i,
    );
    set(indicatorsAtom, indicators);
    localStore.set("indicators", indicators);
  },
);

export const removeIndicatorAtom = atom(null, (_get, set, id: string) => {
  const indicators = _get(indicatorsAtom).filter((i) => i.id !== id);
  set(indicatorsAtom, indicators);
  localStore.set("indicators", indicators);
});

export const clearIndicatorsAtom = atom(null, (_get, set) => {
  set(indicatorsAtom, []);
  localStore.set("indicators", []);
});

export const setCrosshairAtom = atom(
  null,
  (
    _get,
    set,
    c: {
      time: number;
      candle: Candle | null;
    } | null,
  ) => {
    set(crosshairAtom, c);
  },
);

export const setEditingIndicatorAtom = atom(
  null,
  (_get, set, id: string | null) => {
    set(editingIndicatorIdAtom, id);
  },
);

/** Drawing currently open in a settings dialog (e.g. position tool). */
export const editingDrawingIdAtom = atom<string | null>(null);
export const setEditingDrawingAtom = atom(
  null,
  (_get, set, id: string | null) => {
    set(editingDrawingIdAtom, id);
  },
);

export const hydrateAtom = atom(null, (_get, set) => {
  set(
    drawingsAtom,
    localStore.get<Drawing[]>(drawingsKey(_get(symbolAtom)), []),
  );
  set(indicatorsAtom, localStore.get<IndicatorConfig[]>("indicators", []));
});

// ---------------------------------------------------------------------------
// Derived read-only atom (for compatibility / getChartState)
// ---------------------------------------------------------------------------

export const chartStateAtom = atom((get) => ({
  symbol: get(symbolAtom),
  timeframe: get(timeframeAtom),
  candles: get(candlesAtom),
  loading: get(loadingAtom),
  drawings: get(drawingsAtom),
  indicators: get(indicatorsAtom),
  activeTool: get(activeToolAtom),
  drawColor: get(drawColorAtom),
  selectedDrawingId: get(selectedDrawingIdAtom),
  selectedDrawingIds: get(selectedDrawingIdsAtom),
  drawingsLocked: get(drawingsLockedAtom),
  drawingsHidden: get(drawingsHiddenAtom),
  editingIndicatorId: get(editingIndicatorIdAtom),
  crosshair: get(crosshairAtom),
}));

// ---------------------------------------------------------------------------
// Non-React helper
// ---------------------------------------------------------------------------

export function getChartState() {
  return getDefaultStore().get(chartStateAtom);
}

// ---------------------------------------------------------------------------
// Compatibility hook (state reading only)
// ---------------------------------------------------------------------------

type ChartStateSnapshot = ReturnType<typeof getChartState>;

export function useChartStore(): ChartStateSnapshot;
export function useChartStore<T>(selector: (state: ChartStateSnapshot) => T): T;
export function useChartStore<T = ChartStateSnapshot>(
  selector?: (state: ChartStateSnapshot) => T,
): T {
  const state = useAtomValue(chartStateAtom);
  return (selector ? selector(state) : state) as T;
}
