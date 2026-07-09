"use client";
import { atom, getDefaultStore, type Getter, type Setter } from "jotai";
import { useAtomValue } from "jotai";
import type {
  Candle,
  BuiltInIndicatorType,
  CustomIndicatorScript,
  Drawing,
  DrawingTemplate,
  DrawingTool,
  IndicatorConfig,
  Timeframe,
} from "@/types";
import {
  DEFAULT_POSITION_STATS,
  TEMPLATE_STYLE_KEYS,
  styleFamily,
} from "@/types";
import type { Mt5SymbolInfo } from "@/types/mt5";
import { localStore } from "@/services/storage";
import {
  deleteDrawingTemplate,
  listDrawings,
  saveDrawingTemplate,
  syncDrawingsBatch,
  type BackendDrawing,
  type BackendDrawingDelete,
  type BackendDrawingTemplate,
  type BackendDrawingWrite,
} from "@/services/api/resources/drawingsApi";
import {
  deleteIndicatorPreset,
  saveIndicatorPreset,
  type BackendIndicatorPreset,
} from "@/services/api/resources/indicatorsApi";
import {
  backendPineScriptToLocal,
  deletePineScriptRemote,
  getPineScript,
  savePineScriptRemote,
  updatePineScriptRemote,
  type BackendPineScript,
} from "@/services/api/resources/pineScriptsApi";
import { isApiError } from "@/services/api/errors";
import { getDefaultMt5SymbolInfo } from "@/services/mt5/symbolMapping";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { uid } from "@/utils/id";
import { defaultIndicator } from "@/services/indicators";
import { DEFAULT_PINE_SOURCE, extractPineScriptMeta } from "@/services/pineScript";
import { buildOrderPrefillFromPositionDrawing } from "@/components/chart/drawing/tools/positionTradePrefill";
import { orderPrefillAtom, setOrderPrefillAtom } from "./tradeStore";
import { mt5SymbolInfoAtom } from "./mt5Store";
import { logAtom, setBottomTabAtom } from "./uiStore";
import { backendSessionAtom } from "./authStore";

// The backend MT5 catalog selects the first symbol after /api/v1/mt5/symbols loads.
const DEFAULT_SYMBOL = "";
const DEFAULT_TF: Timeframe = "15m";

function drawingsKey(symbol: string) {
  return `drawings:${symbol}`;
}

function isPositionDrawing(drawing: Drawing | null | undefined): drawing is Drawing {
  return drawing?.tool === "long" || drawing?.tool === "short";
}

function touchesPositionTradePlan(patch: Partial<Drawing>) {
  return (
    patch.points !== undefined ||
    patch.riskValue !== undefined ||
    patch.riskUnit !== undefined
  );
}

function latestMarketPrice(candles: Candle[]) {
  return candles[candles.length - 1]?.close ?? null;
}

function positionLotSymbolInfo(
  symbol: string,
  bridgeInfo: Mt5SymbolInfo | undefined,
): Mt5SymbolInfo {
  if (bridgeInfo) return bridgeInfo;
  const fallback = getDefaultMt5SymbolInfo(symbol);
  const marketTickSize = getMarketSymbol(symbol)?.tickSize;
  return marketTickSize ? { ...fallback, tickSize: marketTickSize } : fallback;
}

// Style templates are GLOBAL (not per-symbol) — a trendline preset applies on
// any chart, mirroring TradingView's template list.
const TEMPLATES_KEY = "drawingTemplates";
const PINE_SCRIPTS_KEY = "pineScripts";

type AtomGet = Getter;
type AtomSet = Setter;

function apiMessage(error: unknown): string {
  return isApiError(error)
    ? error.message
    : (error as Error)?.message || "unknown error";
}

function persistLocalDrawings(symbol: string, drawings: Drawing[]) {
  localStore.set(drawingsKey(symbol), drawings);
}

function clearLocalChartWorkspace() {
  localStore.remove("indicators");
  localStore.remove(PINE_SCRIPTS_KEY);
  localStore.remove(TEMPLATES_KEY);
  if (typeof window === "undefined") return;
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("drawings:")) {
      window.localStorage.removeItem(key);
    }
  }
}

function backendDrawingToLocal(row: BackendDrawing): Drawing {
  return {
    ...row.payload,
    id: row.clientId || row.payload.id || row.id,
    tool: row.payload.tool || (row.toolType as DrawingTool),
    locked: row.locked,
    visible: !row.hidden,
  };
}

function localDrawingToBackend(symbol: string, drawing: Drawing): BackendDrawingWrite {
  return {
    symbol,
    toolType: drawing.tool,
    payload: drawing,
    locked: drawing.locked === true,
    hidden: drawing.visible === false,
    clientId: drawing.id,
  };
}

function backendTemplateToLocal(row: BackendDrawingTemplate): DrawingTemplate {
  return {
    ...row.style,
    id: row.id,
    name: row.name,
    family: row.family,
    color: row.style.color || "#2962ff",
  };
}

function localTemplateToBackend(
  template: DrawingTemplate,
): { name: string; family: DrawingTemplate["family"]; style: Partial<DrawingTemplate> } {
  const { id: _id, name, family, ...style } = template;
  return { name, family, style };
}

function backendIndicatorToLocal(row: BackendIndicatorPreset): IndicatorConfig {
  return {
    ...row.config,
    id: row.clientId || row.config.id || row.id,
    type: (row.config.type || row.indicatorType) as IndicatorConfig["type"],
    visible: row.visible,
  };
}

function commitPineScripts(set: AtomSet, scripts: CustomIndicatorScript[]) {
  set(pineScriptsAtom, scripts);
  localStore.set(PINE_SCRIPTS_KEY, scripts);
}

function upsertPineScriptLocal(
  get: AtomGet,
  set: AtomSet,
  script: CustomIndicatorScript,
) {
  const current = get(pineScriptsAtom);
  const next = current.some((item) => item.id === script.id)
    ? current.map((item) => (item.id === script.id ? script : item))
    : [script, ...current];
  commitPineScripts(set, next);
}

async function fetchFullPineScript(
  get: AtomGet,
  set: AtomSet,
  id: string,
): Promise<CustomIndicatorScript | null> {
  const current = get(pineScriptsAtom).find((item) => item.id === id);
  if (current?.sourceCode) return current;
  if (!get(backendSessionAtom)) return current ?? null;
  try {
    const row = await getPineScript(id);
    const script = backendPineScriptToLocal(row);
    upsertPineScriptLocal(get, set, script);
    return script;
  } catch (error) {
    set(logAtom, "error", `Pine script load failed: ${apiMessage(error)}`);
    return current ?? null;
  }
}

async function syncPineScriptSave(
  get: AtomGet,
  set: AtomSet,
  script: CustomIndicatorScript,
) {
  if (!get(backendSessionAtom)) return;
  try {
    const saved = backendPineScriptToLocal(await savePineScriptRemote(script));
    upsertPineScriptLocal(get, set, saved);
  } catch (error) {
    set(logAtom, "error", `Pine script sync failed: ${apiMessage(error)}`);
  }
}

const pendingDrawingUpserts = new Map<string, BackendDrawingWrite>();
const pendingDrawingDeletes = new Map<string, BackendDrawingDelete>();
let drawingSyncTimer: ReturnType<typeof setTimeout> | null = null;

const pendingIndicatorUpserts = new Map<string, IndicatorConfig>();
const pendingIndicatorDeletes = new Set<string>();
let indicatorSyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleDrawingBatchSync(get: AtomGet, set: AtomSet) {
  if (!get(backendSessionAtom)) return;
  if (drawingSyncTimer) clearTimeout(drawingSyncTimer);
  drawingSyncTimer = setTimeout(() => {
    drawingSyncTimer = null;
    const upserts = [...pendingDrawingUpserts.values()];
    const deletes = [...pendingDrawingDeletes.values()];
    if (!upserts.length && !deletes.length) return;
    pendingDrawingUpserts.clear();
    pendingDrawingDeletes.clear();
    void syncDrawingsBatch({ upserts, deletes }).catch((error) => {
      for (const item of upserts) pendingDrawingUpserts.set(item.clientId || item.payload.id, item);
      for (const item of deletes) {
        const key = item.clientId || item.id;
        if (key) pendingDrawingDeletes.set(key, item);
      }
      set(logAtom, "error", `Drawing sync failed: ${apiMessage(error)}`);
    });
  }, 800);
}

function queueDrawingUpsert(get: AtomGet, set: AtomSet, symbol: string, drawing: Drawing) {
  if (!get(backendSessionAtom)) return;
  const write = localDrawingToBackend(symbol, drawing);
  pendingDrawingDeletes.delete(drawing.id);
  pendingDrawingUpserts.set(drawing.id, write);
  scheduleDrawingBatchSync(get, set);
}

function queueDrawingDelete(get: AtomGet, set: AtomSet, symbol: string, drawing: Drawing) {
  if (!get(backendSessionAtom)) return;
  pendingDrawingUpserts.delete(drawing.id);
  pendingDrawingDeletes.set(drawing.id, { clientId: drawing.id, symbol });
  scheduleDrawingBatchSync(get, set);
}

function scheduleIndicatorSync(get: AtomGet, set: AtomSet) {
  if (!get(backendSessionAtom)) return;
  if (indicatorSyncTimer) clearTimeout(indicatorSyncTimer);
  indicatorSyncTimer = setTimeout(() => {
    indicatorSyncTimer = null;
    const upserts = [...pendingIndicatorUpserts.values()];
    const deletes = [...pendingIndicatorDeletes.values()];
    if (!upserts.length && !deletes.length) return;
    pendingIndicatorUpserts.clear();
    pendingIndicatorDeletes.clear();
    const positions = new Map(
      get(indicatorsAtom).map((indicator, index) => [indicator.id, index]),
    );
    void (async () => {
      for (const id of deletes) {
        await deleteIndicatorPreset(id);
      }
      for (const indicator of upserts) {
        await saveIndicatorPreset(indicator, positions.get(indicator.id) ?? 0);
      }
    })().catch((error) => {
      for (const indicator of upserts) pendingIndicatorUpserts.set(indicator.id, indicator);
      for (const id of deletes) pendingIndicatorDeletes.add(id);
      set(logAtom, "error", `Indicator sync failed: ${apiMessage(error)}`);
    });
  }, 600);
}

function queueIndicatorUpsert(get: AtomGet, set: AtomSet, indicator: IndicatorConfig) {
  if (!get(backendSessionAtom)) return;
  pendingIndicatorDeletes.delete(indicator.id);
  pendingIndicatorUpserts.set(indicator.id, indicator);
  scheduleIndicatorSync(get, set);
}

function queueIndicatorDelete(get: AtomGet, set: AtomSet, id: string) {
  if (!get(backendSessionAtom)) return;
  pendingIndicatorUpserts.delete(id);
  pendingIndicatorDeletes.add(id);
  scheduleIndicatorSync(get, set);
}

function commitIndicators(get: AtomGet, set: AtomSet, indicators: IndicatorConfig[]) {
  set(indicatorsAtom, indicators);
  localStore.set("indicators", indicators);
  if (!get(backendSessionAtom)) return;
  indicators.forEach((indicator) => queueIndicatorUpsert(get, set, indicator));
}

// ---------------------------------------------------------------------------
// Primitive atoms (one per state field)
// ---------------------------------------------------------------------------

export const symbolAtom = atom<string>(DEFAULT_SYMBOL);
export const timeframeAtom = atom<Timeframe>(DEFAULT_TF);
export const candlesAtom = atom<Candle[]>([]);
export const loadingAtom = atom<boolean>(false);
export const drawingsAtom = atom<Drawing[]>([]);
export const drawingTemplatesAtom = atom<DrawingTemplate[]>([]);
export const indicatorsAtom = atom<IndicatorConfig[]>([]);
export const pineScriptsAtom = atom<CustomIndicatorScript[]>([]);
export const pineEditorScriptIdAtom = atom<string | null>(null);
export const pineEditorTitleAtom = atom<string>("Untitled script");
export const pineEditorSourceAtom = atom<string>(DEFAULT_PINE_SOURCE);
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

export const loadDrawingsForSymbolAtom = atom(
  null,
  async (_get, set, symbol: string) => {
    if (!symbol || !_get(backendSessionAtom)) return;
    try {
      const rows = await listDrawings(symbol);
      if (_get(symbolAtom) !== symbol) return;
      const drawings = rows.map(backendDrawingToLocal);
      set(drawingsAtom, drawings);
      persistLocalDrawings(symbol, drawings);
    } catch (error) {
      set(logAtom, "warn", `Drawings loaded from local cache: ${apiMessage(error)}`);
    }
  },
);

export const loadActiveSymbolDrawingsAtom = atom(null, (_get, set) => {
  const symbol = _get(symbolAtom);
  if (symbol) void set(loadDrawingsForSymbolAtom, symbol);
});

export const applyRemoteDrawingTemplatesAtom = atom(
  null,
  (_get, set, rows: BackendDrawingTemplate[]) => {
    const templates = rows.map(backendTemplateToLocal);
    set(drawingTemplatesAtom, templates);
    localStore.set(TEMPLATES_KEY, templates);
  },
);

export const applyRemoteIndicatorsAtom = atom(
  null,
  (_get, set, rows: BackendIndicatorPreset[]) => {
    pendingIndicatorUpserts.clear();
    pendingIndicatorDeletes.clear();
    if (indicatorSyncTimer) {
      clearTimeout(indicatorSyncTimer);
      indicatorSyncTimer = null;
    }
    const indicators = rows.map(backendIndicatorToLocal);
    set(indicatorsAtom, indicators);
    localStore.set("indicators", indicators);
  },
);

export const applyRemotePineScriptsAtom = atom(
  null,
  (_get, set, rows: BackendPineScript[]) => {
    commitPineScripts(set, rows.map(backendPineScriptToLocal));
  },
);

// ---------------------------------------------------------------------------
// Write atoms (actions) that read / modify multiple atoms
// ---------------------------------------------------------------------------

export const setSymbolAtom = atom(null, (_get, set, symbol: string) => {
  if (symbol === _get(symbolAtom)) return;
  set(symbolAtom, symbol);
  set(candlesAtom, []);
  set(loadingAtom, true);
  set(drawingsAtom, localStore.get<Drawing[]>(drawingsKey(symbol), []));
  void set(loadDrawingsForSymbolAtom, symbol);
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
  if (_get(candlesAtom) === candles) {
    if (_get(loadingAtom)) set(loadingAtom, false);
    return;
  }
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
    const rr = 1; // TradingView position projection defaults to a symmetric 1:1 box.
    const isLong = drawing.tool === "long";
    const target = entry * (1 + (isLong ? risk * rr : -risk * rr));
    const stop = entry * (1 + (isLong ? -risk : risk));
    drawing.color = drawing.color || "#089981";
    drawing.lineWidth = drawing.lineWidth || 1;
    drawing.accountSize = drawing.accountSize ?? 1000;
    drawing.accountCurrency = drawing.accountCurrency ?? "Default";
    drawing.lotSize = drawing.lotSize ?? 1;
    drawing.riskValue = drawing.riskValue ?? 25;
    drawing.riskUnit = drawing.riskUnit ?? "%";
    drawing.leverage = drawing.leverage ?? 10000;
    drawing.showLabels = drawing.showLabels ?? true;
    drawing.targetColor = drawing.targetColor ?? "#089981";
    drawing.stopColor = drawing.stopColor ?? "#f23645";
    drawing.textColor = drawing.textColor ?? "#ffffff";
    drawing.fontSize = drawing.fontSize ?? 12;
    drawing.positionStats = drawing.positionStats ?? [...DEFAULT_POSITION_STATS];
    drawing.alwaysShowStats = drawing.alwaysShowStats ?? true;
    drawing.points = [
      { time: tEntry, price: entry },
      { time: tRight, price: target },
      { time: tRight, price: stop },
    ];
    const marketPrice = latestMarketPrice(candles);
    const symbol = _get(symbolAtom);
    const prefill = buildOrderPrefillFromPositionDrawing(drawing, marketPrice, {
      symbolInfo: positionLotSymbolInfo(symbol, _get(mt5SymbolInfoAtom)[symbol]),
    });
    if (prefill) {
      set(setOrderPrefillAtom, prefill);
      set(setBottomTabAtom, "trade");
      set(
        logAtom,
        "info",
        `Trade ticket filled from ${isLong ? "Long" : "Short"} Position`,
      );
    }
  }
  if (drawing.tool === "highlighter") {
    drawing.lineWidth = drawing.lineWidth || 8;
    drawing.opacity = drawing.opacity ?? 0.35;
  }
  const drawings = [..._get(drawingsAtom), drawing];
  set(drawingsAtom, drawings);
  // TradingView behaviour: after a drawing is placed, return to the cursor so
  // the new object can immediately be selected and dragged — clicking it again
  // must not keep spawning duplicates.
  set(activeToolAtom, "cursor");
  set(selectedDrawingIdAtom, drawing.id);
  const symbol = _get(symbolAtom);
  persistLocalDrawings(symbol, drawings);
  queueDrawingUpsert(_get, set, symbol, drawing);
});

export const updateDrawingAtom = atom(
  null,
  (_get, set, arg: { id: string; patch: Partial<Drawing> }) => {
    const { id, patch } = arg;
    let updatedDrawing: Drawing | null = null;
    const drawings = _get(drawingsAtom).map((d) => {
      if (d.id !== id) return d;
      updatedDrawing = { ...d, ...patch };
      return updatedDrawing;
    });
    set(drawingsAtom, drawings);
    const symbol = _get(symbolAtom);
    persistLocalDrawings(symbol, drawings);
    if (updatedDrawing) queueDrawingUpsert(_get, set, symbol, updatedDrawing);

    if (isPositionDrawing(updatedDrawing) && touchesPositionTradePlan(patch)) {
      const activePrefill = _get(orderPrefillAtom);
      const isSelected = _get(selectedDrawingIdAtom) === id;
      const isActiveTicketSource =
        activePrefill?.source === "position-drawing" &&
        activePrefill.drawingId === id;
      if (isSelected || isActiveTicketSource) {
        const prefill = buildOrderPrefillFromPositionDrawing(
          updatedDrawing,
          latestMarketPrice(_get(candlesAtom)),
          {
            symbolInfo: positionLotSymbolInfo(
              _get(symbolAtom),
              _get(mt5SymbolInfoAtom)[_get(symbolAtom)],
            ),
          },
        );
        if (prefill) set(setOrderPrefillAtom, prefill);
      }
    }
  },
);

export const removeDrawingAtom = atom(null, (_get, set, id: string) => {
  const symbol = _get(symbolAtom);
  const removed = _get(drawingsAtom).find((d) => d.id === id);
  const drawings = _get(drawingsAtom).filter((d) => d.id !== id);
  set(drawingsAtom, drawings);
  set(selectedDrawingIdAtom, null);
  persistLocalDrawings(symbol, drawings);
  if (removed) queueDrawingDelete(_get, set, symbol, removed);
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
  const symbol = _get(symbolAtom);
  persistLocalDrawings(symbol, drawings);
  queueDrawingUpsert(_get, set, symbol, copy);
});

export const lockDrawingAtom = atom(null, (_get, set, id: string) => {
  let updatedDrawing: Drawing | null = null;
  const drawings = _get(drawingsAtom).map((d) =>
    d.id === id ? (updatedDrawing = { ...d, locked: !d.locked }) : d,
  );
  set(drawingsAtom, drawings);
  const symbol = _get(symbolAtom);
  persistLocalDrawings(symbol, drawings);
  if (updatedDrawing) queueDrawingUpsert(_get, set, symbol, updatedDrawing);
});

export const hideDrawingAtom = atom(null, (_get, set, id: string) => {
  let updatedDrawing: Drawing | null = null;
  const drawings = _get(drawingsAtom).map((d) =>
    d.id === id ? (updatedDrawing = { ...d, visible: d.visible === false }) : d,
  );
  set(drawingsAtom, drawings);
  set(selectedDrawingIdAtom, null);
  const symbol = _get(symbolAtom);
  persistLocalDrawings(symbol, drawings);
  if (updatedDrawing) queueDrawingUpsert(_get, set, symbol, updatedDrawing);
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
    const drawing = selectedDrawingId
      ? _get(drawingsAtom).find((item) => item.id === selectedDrawingId)
      : null;
    if (isPositionDrawing(drawing)) {
      const prefill = buildOrderPrefillFromPositionDrawing(
        drawing,
        latestMarketPrice(_get(candlesAtom)),
        {
          symbolInfo: positionLotSymbolInfo(
            _get(symbolAtom),
            _get(mt5SymbolInfoAtom)[_get(symbolAtom)],
          ),
        },
      );
      if (prefill) set(setOrderPrefillAtom, prefill);
    }
  },
);

export const toggleSelectDrawingAtom = atom(null, (_get, set, id: string) => {
  const prev = _get(selectedDrawingIdsAtom);
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  set(selectedDrawingIdsAtom, next);
  const onlySelectedId = next.size === 1 ? [...next][0] : null;
  set(selectedDrawingIdAtom, onlySelectedId);
  const drawing = onlySelectedId
    ? _get(drawingsAtom).find((item) => item.id === onlySelectedId)
    : null;
  if (isPositionDrawing(drawing)) {
    const prefill = buildOrderPrefillFromPositionDrawing(
      drawing,
      latestMarketPrice(_get(candlesAtom)),
      {
        symbolInfo: positionLotSymbolInfo(
          _get(symbolAtom),
          _get(mt5SymbolInfoAtom)[_get(symbolAtom)],
        ),
      },
    );
    if (prefill) set(setOrderPrefillAtom, prefill);
  }
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
  const symbol = _get(symbolAtom);
  for (const drawing of _get(drawingsAtom)) {
    queueDrawingDelete(_get, set, symbol, drawing);
  }
  set(drawingsAtom, []);
  set(selectedDrawingIdAtom, null);
  set(selectedDrawingIdsAtom, new Set());
  persistLocalDrawings(symbol, []);
});

export const addIndicatorAtom = atom(null, (_get, set, type: BuiltInIndicatorType) => {
  const cfg = defaultIndicator(type, uid("ind"));
  const indicators = [..._get(indicatorsAtom), cfg];
  commitIndicators(_get, set, indicators);
});

export const toggleIndicatorAtom = atom(
  null,
  (_get, set, type: BuiltInIndicatorType) => {
    const current = _get(indicatorsAtom);
    const has = current.some((i) => i.type === type);
    const indicators = has
      ? current.filter((i) => i.type !== type)
      : [...current, defaultIndicator(type, uid("ind"))];
    if (has) {
      current
        .filter((indicator) => indicator.type === type)
        .forEach((indicator) => queueIndicatorDelete(_get, set, indicator.id));
    }
    commitIndicators(_get, set, indicators);
  },
);

export const updateIndicatorAtom = atom(
  null,
  (_get, set, arg: { id: string; patch: Partial<IndicatorConfig> }) => {
    const { id, patch } = arg;
    const indicators = _get(indicatorsAtom).map((i) =>
      i.id === id ? { ...i, ...patch } : i,
    );
    commitIndicators(_get, set, indicators);
  },
);

export const removeIndicatorAtom = atom(null, (_get, set, id: string) => {
  const indicators = _get(indicatorsAtom).filter((i) => i.id !== id);
  queueIndicatorDelete(_get, set, id);
  commitIndicators(_get, set, indicators);
});

export const clearIndicatorsAtom = atom(null, (_get, set) => {
  _get(indicatorsAtom).forEach((indicator) =>
    queueIndicatorDelete(_get, set, indicator.id),
  );
  set(indicatorsAtom, []);
  localStore.set("indicators", []);
});

function customIndicatorConfig(
  script: Pick<CustomIndicatorScript, "id" | "name" | "sourceCode">,
  id = uid("ind"),
): IndicatorConfig {
  const meta = extractPineScriptMeta(script.sourceCode);
  return {
    id,
    type: "CUSTOM",
    length: 0,
    color: "#2962ff",
    visible: true,
    separatePane: !meta.overlay,
    name: script.name.trim() || meta.name,
    scriptId: script.id,
    sourceCode: script.sourceCode,
  };
}

function persistIndicators(get: AtomGet, set: AtomSet, indicators: IndicatorConfig[]) {
  commitIndicators(get, set, indicators);
}

export const newPineScriptAtom = atom(null, (_get, set) => {
  set(pineEditorScriptIdAtom, null);
  set(pineEditorTitleAtom, "Untitled script");
  set(pineEditorSourceAtom, DEFAULT_PINE_SOURCE);
});

export const loadPineScriptAtom = atom(null, async (_get, set, id: string) => {
  const script = await fetchFullPineScript(_get, set, id);
  if (!script?.sourceCode) return;
  set(pineEditorScriptIdAtom, script.id);
  set(pineEditorTitleAtom, script.name);
  set(pineEditorSourceAtom, script.sourceCode);
});

export const savePineScriptAtom = atom(
  null,
  async (
    _get,
    set,
    arg: { id?: string | null; name: string; sourceCode: string },
  ) => {
    const meta = extractPineScriptMeta(arg.sourceCode);
    const now = Date.now();
    const existing = arg.id
      ? _get(pineScriptsAtom).find((item) => item.id === arg.id)
      : undefined;
    const script: CustomIndicatorScript = {
      id: existing?.id ?? uid("pine"),
      name: arg.name.trim() || meta.name || "Untitled script",
      sourceCode: arg.sourceCode,
      favorite: existing?.favorite ?? false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const scripts = existing
      ? _get(pineScriptsAtom).map((item) =>
          item.id === script.id ? script : item,
        )
      : [script, ..._get(pineScriptsAtom)];
    commitPineScripts(set, scripts);
    await syncPineScriptSave(_get, set, script);

    set(pineEditorScriptIdAtom, script.id);
    set(pineEditorTitleAtom, script.name);
    set(pineEditorSourceAtom, script.sourceCode);

    const indicators = _get(indicatorsAtom).map((indicator) =>
      indicator.type === "CUSTOM" && indicator.scriptId === script.id
        ? {
            ...indicator,
            name: script.name,
            sourceCode: script.sourceCode,
            separatePane: !meta.overlay,
            styleValues: indicator.styleValues,
          }
        : indicator,
    );
    persistIndicators(_get, set, indicators);

    return script;
  },
);

export const addCustomIndicatorFromScriptAtom = atom(
  null,
  async (_get, set, script: CustomIndicatorScript) => {
    const fullScript =
      script.sourceCode || !script.id
        ? script
        : await fetchFullPineScript(_get, set, script.id);
    if (!fullScript?.sourceCode) {
      set(logAtom, "error", `Pine source is not loaded for ${script.name}`);
      return;
    }
    const cfg = customIndicatorConfig(fullScript);
    const current = _get(indicatorsAtom);
    const existing = current.find(
      (item) => item.type === "CUSTOM" && item.scriptId === fullScript.id,
    );
    const indicators = existing
      ? current.map((item) =>
          item.id === existing.id
            ? {
                ...cfg,
                id: existing.id,
                visible: true,
                inputValues: existing.inputValues,
                styleValues: existing.styleValues,
              }
            : item,
        )
      : [...current, cfg];
    persistIndicators(_get, set, indicators);
  },
);

export const addCustomIndicatorFromSourceAtom = atom(
  null,
  (
    _get,
    set,
    arg: { name: string; sourceCode: string; scriptId?: string | null },
  ) => {
    const meta = extractPineScriptMeta(arg.sourceCode);
    const cfg = customIndicatorConfig({
      id: arg.scriptId ?? uid("pine-draft"),
      name: arg.name.trim() || meta.name,
      sourceCode: arg.sourceCode,
    });
    const current = _get(indicatorsAtom);
    const existing = arg.scriptId
      ? current.find(
          (item) => item.type === "CUSTOM" && item.scriptId === arg.scriptId,
        )
      : undefined;
    const indicators = existing
      ? current.map((item) =>
          item.id === existing.id
            ? {
                ...cfg,
                id: existing.id,
                inputValues: existing.inputValues,
                styleValues: existing.styleValues,
              }
            : item,
        )
      : [...current, cfg];
    persistIndicators(_get, set, indicators);
  },
);

export const deletePineScriptAtom = atom(null, async (_get, set, id: string) => {
  const scripts = _get(pineScriptsAtom).filter((item) => item.id !== id);
  commitPineScripts(set, scripts);
  if (_get(pineEditorScriptIdAtom) === id) {
    set(newPineScriptAtom);
  }
  if (_get(backendSessionAtom)) {
    try {
      await deletePineScriptRemote(id);
    } catch (error) {
      set(logAtom, "error", `Pine script delete failed: ${apiMessage(error)}`);
    }
  }
});

export const togglePineFavoriteAtom = atom(null, async (_get, set, id: string) => {
  const nextFavorite =
    !_get(pineScriptsAtom).find((item) => item.id === id)?.favorite;
  const scripts = _get(pineScriptsAtom).map((item) =>
    item.id === id ? { ...item, favorite: !item.favorite } : item,
  );
  commitPineScripts(set, scripts);
  if (_get(backendSessionAtom)) {
    try {
      const saved = backendPineScriptToLocal(
        await updatePineScriptRemote(id, { favorite: nextFavorite }),
      );
      upsertPineScriptLocal(_get, set, saved);
    } catch (error) {
      set(logAtom, "error", `Pine favorite sync failed: ${apiMessage(error)}`);
    }
  }
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
    if (_get(backendSessionAtom)) {
      void saveDrawingTemplate(localTemplateToBackend(template))
        .then((row) => {
          const saved = backendTemplateToLocal(row);
          const latest = _get(drawingTemplatesAtom);
          const updated = [
            ...latest.filter(
              (t) => !(t.name === saved.name && t.family === saved.family),
            ),
            saved,
          ];
          set(drawingTemplatesAtom, updated);
          localStore.set(TEMPLATES_KEY, updated);
        })
        .catch((error) => {
          set(logAtom, "error", `Template save failed: ${apiMessage(error)}`);
        });
    }
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
    const removed = _get(drawingTemplatesAtom).find(
      (t) => t.name === arg.name && t.family === arg.family,
    );
    const next = _get(drawingTemplatesAtom).filter(
      (t) => !(t.name === arg.name && t.family === arg.family),
    );
    set(drawingTemplatesAtom, next);
    localStore.set(TEMPLATES_KEY, next);
    if (_get(backendSessionAtom) && removed?.id) {
      void deleteDrawingTemplate(removed.id).catch((error) => {
        set(logAtom, "error", `Template delete failed: ${apiMessage(error)}`);
      });
    }
  },
);

export const hydrateAtom = atom(null, (_get, set) => {
  set(
    drawingsAtom,
    localStore.get<Drawing[]>(drawingsKey(_get(symbolAtom)), []),
  );
  set(indicatorsAtom, localStore.get<IndicatorConfig[]>("indicators", []));
  set(
    pineScriptsAtom,
    localStore.get<CustomIndicatorScript[]>(PINE_SCRIPTS_KEY, []),
  );
  set(
    drawingTemplatesAtom,
    localStore.get<DrawingTemplate[]>(TEMPLATES_KEY, []),
  );
});

export const resetChartWorkspaceToDefaultsAtom = atom(null, (_get, set) => {
  if (drawingSyncTimer) {
    clearTimeout(drawingSyncTimer);
    drawingSyncTimer = null;
  }
  if (indicatorSyncTimer) {
    clearTimeout(indicatorSyncTimer);
    indicatorSyncTimer = null;
  }
  pendingDrawingUpserts.clear();
  pendingDrawingDeletes.clear();
  pendingIndicatorUpserts.clear();
  pendingIndicatorDeletes.clear();

  set(drawingsAtom, []);
  set(drawingTemplatesAtom, []);
  set(indicatorsAtom, []);
  set(pineScriptsAtom, []);
  set(pineEditorScriptIdAtom, null);
  set(pineEditorTitleAtom, "Untitled script");
  set(pineEditorSourceAtom, DEFAULT_PINE_SOURCE);
  set(activeToolAtom, "cursor");
  set(drawColorAtom, "#2962ff");
  set(selectedDrawingIdAtom, null);
  set(selectedDrawingIdsAtom, new Set());
  set(drawingsLockedAtom, false);
  set(drawingsHiddenAtom, false);
  set(editingIndicatorIdAtom, null);
  set(editingDrawingIdAtom, null);
  set(crosshairAtom, null);
  set(orderPrefillAtom, null);
  clearLocalChartWorkspace();
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
  pineScripts: get(pineScriptsAtom),
  pineEditorScriptId: get(pineEditorScriptIdAtom),
  pineEditorTitle: get(pineEditorTitleAtom),
  pineEditorSource: get(pineEditorSourceAtom),
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
