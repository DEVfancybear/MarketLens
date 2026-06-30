"use client";
import { atom, getDefaultStore } from "jotai";
import { useAtomValue } from "jotai";
import type {
  Candle,
  Drawing,
  DrawingTemplate,
  DrawingTool,
  IndicatorConfig,
  IndicatorType,
  Timeframe,
} from "@/types";
import { TEMPLATE_STYLE_KEYS, styleFamily } from "@/types";
import { localStore } from "@/services/storage";
import { uid } from "@/utils/id";
import { defaultIndicator } from "@/services/indicators";

// Default to a Binance crypto symbol so the chart streams live with no API key.
const DEFAULT_SYMBOL = "BTCUSDT";
const DEFAULT_TF: Timeframe = "15m";

function drawingsKey(symbol: string) {
  return `drawings:${symbol}`;
}

// Style templates are GLOBAL (not per-symbol) — a trendline preset applies on
// any chart, mirroring TradingView's template list.
const TEMPLATES_KEY = "drawingTemplates";

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
  set(drawingsAtom, drawings);
  // TradingView behaviour: after a drawing is placed, return to the cursor so
  // the new object can immediately be selected and dragged — clicking it again
  // must not keep spawning duplicates.
  set(activeToolAtom, "cursor");
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

// ---------------------------------------------------------------------------
// Drawing style templates (global, style-only presets)
// ---------------------------------------------------------------------------

export const drawingTemplatesAtom = atom<DrawingTemplate[]>([]);

/** Extract the style-only subset from a drawing. */
function styleSubset(d: Drawing): Partial<Drawing> {
  const out: Partial<Drawing> = {};
  for (const k of TEMPLATE_STYLE_KEYS) {
    const v = d[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Save the selected drawing's style as a named, family-scoped template. */
export const saveTemplateAtom = atom(
  null,
  (_get, set, arg: { id: string; name: string }) => {
    const d = _get(drawingsAtom).find((x) => x.id === arg.id);
    if (!d) return;
    const name = arg.name.trim();
    if (!name) return;
    const template: DrawingTemplate = {
      name,
      family: styleFamily(d.tool),
      color: d.color,
      ...styleSubset(d),
    };
    // Replace any existing template with the same name + family.
    const next = [
      ..._get(drawingTemplatesAtom).filter(
        (t) => !(t.name === name && t.family === template.family),
      ),
      template,
    ];
    set(drawingTemplatesAtom, next);
    localStore.set(TEMPLATES_KEY, next);
  },
);

/** Apply a saved template's style subset to a drawing (never points/id). */
export const applyTemplateAtom = atom(
  null,
  (_get, set, arg: { id: string; template: DrawingTemplate }) => {
    const { id, template } = arg;
    const patch: Partial<Drawing> = { color: template.color };
    for (const k of TEMPLATE_STYLE_KEYS) {
      const v = template[k as keyof DrawingTemplate];
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }
    set(updateDrawingAtom, { id, patch });
  },
);

export const deleteTemplateAtom = atom(
  null,
  (_get, set, arg: { name: string; family: DrawingTemplate["family"] }) => {
    const next = _get(drawingTemplatesAtom).filter(
      (t) => !(t.name === arg.name && t.family === arg.family),
    );
    set(drawingTemplatesAtom, next);
    localStore.set(TEMPLATES_KEY, next);
  },
);

export const hydrateAtom = atom(null, (_get, set) => {
  set(
    drawingsAtom,
    localStore.get<Drawing[]>(drawingsKey(_get(symbolAtom)), []),
  );
  set(indicatorsAtom, localStore.get<IndicatorConfig[]>("indicators", []));
  set(
    drawingTemplatesAtom,
    localStore.get<DrawingTemplate[]>(TEMPLATES_KEY, []),
  );
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
