"use client";
import { atom, getDefaultStore, type Getter, type Setter } from "jotai";
import { useAtomValue } from "jotai";
import type {
  Candle,
  CustomIndicatorScript,
  Drawing,
  DrawingTemplate,
  DrawingTool,
  DrawingSyncMode,
  IndicatorConfig,
  Timeframe,
} from "@/types";
import { TF_SECONDS, styleFamily } from "@/types";
import {
  getDrawingToolManifestEntry,
  getDrawingToolPositionSide,
} from "@/types/drawingToolManifest";
import {
  applyDrawingTemplateStyle,
  pickDrawingTemplateStyle,
} from "@/components/chart/drawing/settings/drawingSettingsSchema";
import type { Mt5SymbolInfo } from "@/types/mt5";
import { localStore } from "@/services/storage";
import { createSettingsMutationQueue } from "@/services/api/settingsMutationQueue";
import { patchSettings } from "@/services/api/resources/settingsApi";
import {
  normalizeChartSymbol,
  resolveCurrentChartSymbol,
} from "@/services/chartSettingsPersistence";
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
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
import { getDefaultMt5SymbolInfo } from "@/services/mt5/symbolMapping";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { uid } from "@/utils/id";
import { DEFAULT_PINE_SOURCE } from "@/services/pineRuntimeTypes";
import {
  indicatorConfigFromDefinition,
  loadIndicatorDefinition,
} from "@/services/indicatorDefinitions";
import type { IndicatorRuntimeDefinition } from "@/services/api/resources/indicatorRuntimeApi";
import { buildOrderPrefillFromPositionDrawing } from "@/components/chart/drawing/tools/positionTradePrefill";
import {
  initializePositionDrawing,
  resolvePositionCreationTimeline,
  type PositionDrawingCreationOptions,
} from "@/components/chart/drawing/tools/positionCreation";
import { resolveCandleBarIntervalSeconds } from "@/components/chart/drawing/coordinates/drawingCoordinates";
import { orderPrefillAtom, setOrderPrefillAtom } from "./tradeStore";
import { mt5SymbolInfoAtom } from "./mt5Store";
import { logAtom } from "./uiStore";
import { pushToastAtom } from "./toastStore";
import { appLanguageAtom } from "./localeStore";
import { translate } from "@/i18n/localization";
import { backendSessionAtom } from "./authStore";
import {
  decodeDrawingList,
  decodeDrawingTemplateList,
  encodeDrawing,
  encodeDrawingList,
  type DrawingDecodeIssue,
} from "@/components/chart/drawing/persistence/drawingCodec";
import {
  DrawingSyncQueue,
  type DrawingSyncQueueSnapshot,
} from "@/components/chart/drawing/persistence/DrawingSyncQueue";
import { DrawingLoadGuard } from "@/components/chart/drawing/persistence/DrawingLoadGuard";
import { rebaseDrawingBatchForLastWriteWins } from "@/components/chart/drawing/persistence/drawingConflictPolicy";
import { ApiError } from "@/services/api/errors";
import { drawingPersistenceMetrics } from "@/components/chart/drawing/persistence/drawingPersistenceMetrics";
import {
  decodeDrawingToolPreferences,
  EMPTY_DRAWING_TOOL_PREFERENCES,
  pickDrawingToolDefaults,
  type DrawingToolPreferences,
  type DrawingMagnetMode,
} from "@/components/chart/drawing/settings/drawingToolPreferences";
import {
  normalizeEmojiRecents,
  pushEmojiRecent,
  type EmojiPickerSelection,
} from "@/types/emojiCatalog";
import {
  CHART_TIME_ZONE_STORAGE_KEY,
  EXCHANGE_TIME_ZONE_ID,
  isSupportedChartTimeZone,
  type ChartTimeZoneId,
} from "@/components/chart/chartTimeNavigation";
import {
  DEFAULT_DRAWING_CHART_ID,
  DEFAULT_DRAWING_LAYOUT_ID,
  DEFAULT_DRAWING_SYNC_MODE,
  DRAWING_SYNC_MODE_VERSION,
  drawingSyncBinding,
  drawingSyncMode,
  mergeDrawingSyncRegistry,
  resolveDrawingSyncModeSetting,
  selectDrawingsForSyncContext,
  type DrawingSyncContext,
} from "@/components/chart/drawing/persistence/drawingSyncScope";
import {
  bindIndicatorToChart,
  mergeIndicatorLayoutRegistry,
  rebindIndicatorsToLayout,
  scopeLegacyIndicatorsToChart,
  selectIndicatorsForChart,
  selectIndicatorsForLayout,
  type IndicatorChartContext,
} from "@/components/chart/indicators/indicatorChartScope";
import {
  applyDrawingBatchUpdates,
  type DrawingPatchUpdate,
} from "./drawingBatchUpdate";

export type { DrawingPatchUpdate } from "./drawingBatchUpdate";

// The backend MT5 catalog selects the first symbol after /api/v1/mt5/symbols loads.
const DEFAULT_SYMBOL = "";
const DEFAULT_TF: Timeframe = "15m";
const chartSettingsSync = createSettingsMutationQueue("chart");

function drawingsKey(symbol: string) {
  return `drawings:${symbol}`;
}

function isPositionDrawing(drawing: Drawing | null | undefined): drawing is Drawing {
  return !!drawing && getDrawingToolPositionSide(drawing.tool) !== undefined;
}

function touchesPositionTradePlan(patch: Partial<Drawing>) {
  return (
    patch.points !== undefined ||
    patch.riskValue !== undefined ||
    patch.riskUnit !== undefined
  );
}

function syncPositionDrawingPrefill(
  get: AtomGet,
  set: AtomSet,
  id: string,
  patch: Partial<Drawing>,
  drawing: Drawing | null | undefined,
) {
  if (!isPositionDrawing(drawing) || !touchesPositionTradePlan(patch)) return;

  const activePrefill = get(orderPrefillAtom);
  const isSelected = get(selectedDrawingIdAtom) === id;
  const isActiveTicketSource =
    activePrefill?.source === "position-drawing" &&
    activePrefill.drawingId === id;
  if (!isSelected && !isActiveTicketSource) return;

  const symbol = get(symbolAtom);
  const prefill = buildOrderPrefillFromPositionDrawing(
    drawing,
    latestMarketPrice(get(candlesAtom)),
    {
      symbolInfo: positionLotSymbolInfo(
        symbol,
        get(mt5SymbolInfoAtom)[symbol],
      ),
    },
  );
  if (prefill) set(setOrderPrefillAtom, prefill);
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
const DRAWING_TOOL_PREFERENCES_KEY = "drawingToolPreferences";
const DRAWING_SYNC_MODE_KEY = "drawingSyncMode";
const DRAWING_SYNC_MODE_VERSION_KEY = "drawingSyncModeVersion";
const CURRENT_SYMBOL_KEY = "currentChartSymbol";
const CURRENT_SYMBOL_PENDING_KEY = "currentChartSymbolPending";

type AtomGet = Getter;
type AtomSet = Setter;

function apiMessage(error: unknown): string {
  return userFacingErrorMessage(error, "unknown error");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeChartTimeZone(value: unknown): ChartTimeZoneId {
  return typeof value === "string" && isSupportedChartTimeZone(value)
    ? value
    : EXCHANGE_TIME_ZONE_ID;
}

function readStoredChartTimeZone(): ChartTimeZoneId {
  if (typeof window === "undefined") return EXCHANGE_TIME_ZONE_ID;
  const raw = window.localStorage.getItem(CHART_TIME_ZONE_STORAGE_KEY);
  if (!raw) return EXCHANGE_TIME_ZONE_ID;
  try {
    return normalizeChartTimeZone(JSON.parse(raw));
  } catch {
    // Migrate the legacy value, which was stored as an unquoted raw string.
    return normalizeChartTimeZone(raw);
  }
}

function queueChartSettings(
  get: AtomGet,
  set: AtomSet,
  patch: Record<string, unknown>,
): void {
  if (!get(backendSessionAtom)) return;
  chartSettingsSync.enqueue(patch, (error) => {
    set(logAtom, "error", `Chart settings sync failed: ${apiMessage(error)}`);
  });
}

export const persistChartWorkspaceLayoutAtom = atom(
  null,
  (get, set, workspaceLayout: unknown) => {
    queueChartSettings(get, set, { workspaceLayout });
  },
);

function commitDrawingToolPreferences(
  get: AtomGet,
  set: AtomSet,
  preferences: DrawingToolPreferences,
): void {
  set(drawingToolPreferencesAtom, preferences);
  localStore.set(DRAWING_TOOL_PREFERENCES_KEY, preferences);
  queueChartSettings(get, set, { drawingToolPreferences: preferences });
}

function syncContext(get: AtomGet, symbol = get(symbolAtom)): DrawingSyncContext {
  return {
    symbol,
    layoutId: get(drawingLayoutIdAtom),
    chartId: get(drawingChartIdAtom),
  };
}

function indicatorContext(get: AtomGet): IndicatorChartContext {
  return {
    layoutId: get(drawingLayoutIdAtom),
    chartId: get(drawingChartIdAtom),
  };
}

function readDrawingRegistry(symbol: string): Drawing[] {
  return decodeDrawingList(localStore.get<unknown>(drawingsKey(symbol), [])).drawings;
}

export function getCachedDrawingsForContext(
  context: DrawingSyncContext,
): Drawing[] {
  return selectDrawingsForSyncContext(readDrawingRegistry(context.symbol), context);
}

function persistDrawingRegistry(symbol: string, registry: Drawing[]) {
  localStore.set(drawingsKey(symbol), encodeDrawingList(registry));
}

function persistLocalDrawings(get: AtomGet, symbol: string, drawings: Drawing[]) {
  const registry = mergeDrawingSyncRegistry(
    readDrawingRegistry(symbol),
    drawings,
    syncContext(get, symbol),
  );
  persistDrawingRegistry(symbol, registry);
}

function quarantineKey(symbol: string) {
  return `drawingQuarantine:${symbol}`;
}

function decodeDrawingsAtBoundary(
  symbol: string,
  value: unknown,
  source: "local" | "backend" | "layout",
): Drawing[] {
  const decoded = decodeDrawingList(value);
  if (decoded.quarantined.length > 0) {
    drawingPersistenceMetrics.add("decodeFailures", decoded.quarantined.length);
    drawingPersistenceMetrics.add("quarantined", decoded.quarantined.length);
    localStore.set(quarantineKey(symbol), decoded.quarantined);
    for (const { issue } of decoded.quarantined) {
      // Metadata only: never log user coordinates, text, or styles.
      console.warn("[drawing-decode]", {
        source,
        symbol,
        code: issue.code,
        tool: issue.tool,
        schemaVersion: issue.schemaVersion,
      } satisfies { source: string; symbol: string } & Partial<DrawingDecodeIssue>);
    }
  }
  drawingPersistenceMetrics.add("migrated", decoded.migrated);
  if (decoded.migrated > 0) persistDrawingRegistry(symbol, decoded.drawings);
  return decoded.drawings;
}

function clearLocalChartWorkspace() {
  localStore.remove("indicators");
  localStore.remove(PINE_SCRIPTS_KEY);
  localStore.remove(TEMPLATES_KEY);
  localStore.remove(DRAWING_SYNC_MODE_KEY);
  localStore.remove(DRAWING_SYNC_MODE_VERSION_KEY);
  localStore.remove(DRAWING_TOOL_PREFERENCES_KEY);
  localStore.remove(CHART_TIME_ZONE_STORAGE_KEY);
  localStore.remove(CURRENT_SYMBOL_KEY);
  localStore.remove(CURRENT_SYMBOL_PENDING_KEY);
  if (typeof window === "undefined") return;
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("drawings:")) {
      window.localStorage.removeItem(key);
    }
  }
}

function backendDrawingToLocal(row: BackendDrawing): unknown {
  return {
    ...row.payload,
    id: row.clientId || row.payload.id || row.id,
    tool: row.payload.tool || (row.toolType as DrawingTool),
    locked: row.locked,
    visible: !row.hidden,
    serverRevision: row.revision,
    clientRevision: row.clientRevision ?? row.payload.clientRevision ?? 0,
  };
}

function localDrawingToBackend(symbol: string, drawing: Drawing): BackendDrawingWrite {
  return {
    symbol,
    toolType: drawing.tool,
    payload: encodeDrawing(drawing),
    locked: drawing.locked === true,
    hidden: drawing.visible === false,
    clientId: drawing.id,
    clientRevision: drawing.clientRevision ?? 0,
    expectedRevision: drawing.serverRevision,
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

const DRAWING_OUTBOX_KEY = "drawingSyncOutbox:v1";
const drawingLoadGuard = new DrawingLoadGuard();
let drawingQueueContext: { get: AtomGet; set: AtomSet } | null = null;
let drawingOutboxHydrated = false;

function acknowledgeDrawingBatch(rows: BackendDrawing[]) {
  const context = drawingQueueContext;
  if (!context || rows.length === 0) return;
  const activeSymbol = context.get(symbolAtom);
  const byID = new Map(rows.map((row) => [row.clientId || row.payload.id, row]));
  const current = context.get(drawingsAtom);
  let changed = false;
  const next = current.map((drawing) => {
    const row = byID.get(drawing.id);
    if (!row || drawing.serverRevision === row.revision) return drawing;
    changed = true;
    return { ...drawing, serverRevision: row.revision };
  });
  if (changed) {
    context.set(drawingsAtom, next);
    persistLocalDrawings(context.get, activeSymbol, next);
  }
}

async function syncDrawingBatchWithConflictResolution(
  request: Parameters<typeof syncDrawingsBatch>[0],
) {
  try {
    return await syncDrawingsBatch(request);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const symbols = new Set<string>();
    request.upserts.forEach((item) => symbols.add(item.symbol));
    request.deletes.forEach((item) => item.symbol && symbols.add(item.symbol));
    const remote = (
      await Promise.all([...symbols].map((symbol) => listDrawings(symbol)))
    ).flat();
    console.warn("[drawing-conflict]", {
      policy: "last-write-wins",
      objects: request.upserts.length + request.deletes.length,
    });
    drawingPersistenceMetrics.add("conflicts");
    return syncDrawingsBatch(rebaseDrawingBatchForLastWriteWins(request, remote));
  }
}

const drawingSyncQueue = new DrawingSyncQueue({
  send: syncDrawingBatchWithConflictResolution,
  canSend: () => !!drawingQueueContext?.get(backendSessionAtom),
  persist: (snapshot) => localStore.set(DRAWING_OUTBOX_KEY, snapshot),
  onSuccess: (response) => acknowledgeDrawingBatch(response.upserted),
  onError: (error, retryAttempt) => {
    drawingPersistenceMetrics.add("retries");
    drawingQueueContext?.set(
      logAtom,
      "error",
      `Drawing sync failed (retry ${retryAttempt}): ${apiMessage(error)}`,
    );
  },
});

function ensureDrawingOutboxHydrated() {
  if (drawingOutboxHydrated) return;
  drawingOutboxHydrated = true;
  drawingSyncQueue.hydrate(
    localStore.get<DrawingSyncQueueSnapshot | null>(DRAWING_OUTBOX_KEY, null),
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void chartSettingsSync.flush();
    ensureDrawingOutboxHydrated();
    drawingSyncQueue.preserveAndCancel();
  });
}

const pendingIndicatorUpserts = new Map<string, IndicatorConfig>();
const pendingIndicatorDeletes = new Set<string>();
let indicatorSyncTimer: ReturnType<typeof setTimeout> | null = null;

function queueDrawingUpsert(get: AtomGet, set: AtomSet, symbol: string, drawing: Drawing) {
  drawingQueueContext = { get, set };
  ensureDrawingOutboxHydrated();
  const write = localDrawingToBackend(symbol, drawing);
  drawingSyncQueue.enqueueUpsert(write);
}

function queueDrawingDelete(get: AtomGet, set: AtomSet, symbol: string, drawing: Drawing) {
  drawingQueueContext = { get, set };
  ensureDrawingOutboxHydrated();
  drawingSyncQueue.enqueueDelete({
    clientId: drawing.id,
    symbol,
    expectedRevision: drawing.serverRevision,
  });
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
export const chartTimeZoneAtom = atom<ChartTimeZoneId>(EXCHANGE_TIME_ZONE_ID);
/** Resolved IANA zone used by chart labels and every notification channel. */
export const resolvedChartTimeZoneAtom = atom<string>("UTC");
export const candlesAtom = atom<Candle[]>([]);
export const loadingAtom = atom<boolean>(false);
export const drawingsAtom = atom<Drawing[]>([]);
export const drawingLayoutIdAtom = atom<string>(DEFAULT_DRAWING_LAYOUT_ID);
export const drawingChartIdAtom = atom<string>(DEFAULT_DRAWING_CHART_ID);
export const newDrawingSyncModeAtom = atom<DrawingSyncMode>(DEFAULT_DRAWING_SYNC_MODE);
export const drawingTemplatesAtom = atom<DrawingTemplate[]>([]);
export const indicatorsAtom = atom<IndicatorConfig[]>([]);
export const pineScriptsAtom = atom<CustomIndicatorScript[]>([]);
export const pineEditorScriptIdAtom = atom<string | null>(null);
export const pineEditorTitleAtom = atom<string>("Untitled script");
export const pineEditorSourceAtom = atom<string>(DEFAULT_PINE_SOURCE);
export const activeToolAtom = atom<DrawingTool>("crosshair");
export const drawColorAtom = atom<string>("#2962ff");
export const drawingToolPreferencesAtom = atom<DrawingToolPreferences>(
  EMPTY_DRAWING_TOOL_PREFERENCES,
);
export const keepDrawingModeAtom = atom((get) =>
  get(drawingToolPreferencesAtom).keepDrawing,
);
export const selectedDrawingIdAtom = atom<string | null>(null);
export const selectedDrawingIdsAtom = atom<Set<string>>(new Set<string>());
export const editingIndicatorIdAtom = atom<string | null>(null);
export const crosshairAtom = atom<{
  time: number;
  candle: Candle | null;
} | null>(null);
/** Active-pane projection of the account-wide indicator preset registry. */
export const activeIndicatorsAtom = atom((get) =>
  selectIndicatorsForChart(get(indicatorsAtom), indicatorContext(get)),
);

export const setDrawingLayoutContextAtom = atom(
  null,
  (_get, set, context: { layoutId: string; chartId?: string }) => {
    const layoutId = context.layoutId || DEFAULT_DRAWING_LAYOUT_ID;
    const chartId = context.chartId || DEFAULT_DRAWING_CHART_ID;
    const symbol = _get(symbolAtom);
    const registry = mergeDrawingSyncRegistry(
      readDrawingRegistry(symbol),
      _get(drawingsAtom),
      syncContext(_get, symbol),
    );
    set(drawingLayoutIdAtom, layoutId);
    set(drawingChartIdAtom, chartId);
    set(
      drawingsAtom,
      selectDrawingsForSyncContext(registry, { symbol, layoutId, chartId }),
    );
    set(selectedDrawingIdAtom, null);
    set(selectedDrawingIdsAtom, new Set());
    if (symbol && _get(backendSessionAtom)) {
      void set(loadDrawingsForSymbolAtom, symbol);
    }
  },
);

export const adoptDrawingLayoutContextAtom = atom(
  null,
  (_get, set, context: { layoutId: string; chartId?: string }) => {
    const previousLayoutId = _get(drawingLayoutIdAtom);
    const layoutId = context.layoutId || DEFAULT_DRAWING_LAYOUT_ID;
    const chartId = context.chartId || DEFAULT_DRAWING_CHART_ID;
    const reboundIndicators = rebindIndicatorsToLayout(
      selectIndicatorsForLayout(_get(indicatorsAtom), previousLayoutId),
      { layoutId, chartId },
    );
    const indicatorRegistry = mergeIndicatorLayoutRegistry(
      _get(indicatorsAtom),
      reboundIndicators,
      previousLayoutId,
    );
    set(drawingLayoutIdAtom, layoutId);
    set(drawingChartIdAtom, chartId);
    const nextContext = { symbol: _get(symbolAtom), layoutId, chartId };
    const changed: Drawing[] = [];
    const drawings = _get(drawingsAtom).map((drawing) => {
      const mode = drawingSyncMode(drawing);
      if (mode === "global") return drawing;
      const next = {
        ...drawing,
        sync: drawingSyncBinding(mode, nextContext),
        clientRevision: (drawing.clientRevision ?? 0) + 1,
      };
      changed.push(next);
      return next;
    });
    set(drawingsAtom, drawings);
    commitIndicators(_get, set, indicatorRegistry);
    persistLocalDrawings(_get, nextContext.symbol, drawings);
    for (const drawing of changed) {
      queueDrawingUpsert(_get, set, nextContext.symbol, drawing);
    }
  },
);

export const setNewDrawingSyncModeAtom = atom(
  null,
  (_get, set, mode: DrawingSyncMode) => {
    set(newDrawingSyncModeAtom, mode);
    localStore.set(DRAWING_SYNC_MODE_KEY, mode);
    localStore.set(DRAWING_SYNC_MODE_VERSION_KEY, DRAWING_SYNC_MODE_VERSION);
    queueChartSettings(_get, set, {
      drawingSyncMode: mode,
      drawingSyncModeVersion: DRAWING_SYNC_MODE_VERSION,
    });
  },
);

export const loadDrawingsForSymbolAtom = atom(
  null,
  async (_get, set, symbol: string) => {
    if (!symbol || !_get(backendSessionAtom)) return;
    const loadToken = drawingLoadGuard.begin(symbol);
    drawingQueueContext = { get: _get, set };
    ensureDrawingOutboxHydrated();
    try {
      const local = decodeDrawingsAtBoundary(
        symbol,
        localStore.get<unknown>(drawingsKey(symbol), []),
        "local",
      );
      const rows = await listDrawings(symbol);
      if (!drawingLoadGuard.isCurrent(loadToken, _get(symbolAtom))) return;
      const remote = decodeDrawingsAtBoundary(
        symbol,
        rows.map(backendDrawingToLocal),
        "backend",
      );
      const remoteByID = new Map(remote.map((drawing) => [drawing.id, drawing]));
      for (const drawing of local) {
        const server = remoteByID.get(drawing.id);
        if (!server || (drawing.clientRevision ?? 0) > (server.clientRevision ?? 0)) {
          remoteByID.set(drawing.id, drawing);
          queueDrawingUpsert(_get, set, symbol, drawing);
        }
      }
      const registry = [...remoteByID.values()];
      const drawings = selectDrawingsForSyncContext(registry, syncContext(_get, symbol));
      set(drawingsAtom, drawings);
      persistDrawingRegistry(symbol, registry);
    } catch (error) {
      set(logAtom, "warn", `Drawings loaded from local cache: ${apiMessage(error)}`);
    } finally {
      drawingSyncQueue.resume();
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
    const templates = decodeDrawingTemplateList(rows.map(backendTemplateToLocal));
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
    const indicators = scopeLegacyIndicatorsToChart(
      rows.map(backendIndicatorToLocal),
      indicatorContext(_get),
    );
    set(indicatorsAtom, indicators);
    localStore.set("indicators", indicators);
  },
);

export const applyRemoteChartSettingsAtom = atom(
  null,
  (_get, set, payload: unknown) => {
    chartSettingsSync.cancelPending();
    const settings = isRecord(payload) ? payload : {};
    const remoteSymbol = normalizeChartSymbol(settings.symbol) || "EURUSD";
    const localSymbol = normalizeChartSymbol(
      localStore.get<unknown>(CURRENT_SYMBOL_KEY, ""),
    );
    const symbolWritePending = localStore.get<boolean>(
      CURRENT_SYMBOL_PENDING_KEY,
      false,
    );
    const symbol = resolveCurrentChartSymbol({
      remote: remoteSymbol,
      local: localSymbol,
      localWritePending: symbolWritePending,
    });
    const timeZone = normalizeChartTimeZone(settings.timeZone);
    const drawingToolPreferences = decodeDrawingToolPreferences(
      settings.drawingToolPreferences,
    );
    const {
      mode: drawingSyncMode,
      needsMigration: drawingSyncModeNeedsMigration,
    } = resolveDrawingSyncModeSetting(
      settings.drawingSyncMode,
      settings.drawingSyncModeVersion,
    );

    if (symbol !== _get(symbolAtom)) {
      drawingLoadGuard.cancel();
      set(symbolAtom, symbol);
      set(candlesAtom, []);
      set(loadingAtom, true);
      const registry = decodeDrawingsAtBoundary(
        symbol,
        localStore.get<unknown>(drawingsKey(symbol), []),
        "local",
      );
      set(
        drawingsAtom,
        selectDrawingsForSyncContext(registry, syncContext(_get, symbol)),
      );
      void set(loadDrawingsForSymbolAtom, symbol);
      set(selectedDrawingIdAtom, null);
      set(selectedDrawingIdsAtom, new Set());
    }
    set(chartTimeZoneAtom, timeZone);
    set(
      resolvedChartTimeZoneAtom,
      timeZone === EXCHANGE_TIME_ZONE_ID ? "UTC" : timeZone,
    );
    set(drawingToolPreferencesAtom, drawingToolPreferences);
    set(newDrawingSyncModeAtom, drawingSyncMode);
    localStore.set(CURRENT_SYMBOL_KEY, symbol);
    localStore.set(CHART_TIME_ZONE_STORAGE_KEY, timeZone);
    localStore.set(DRAWING_TOOL_PREFERENCES_KEY, drawingToolPreferences);
    localStore.set(DRAWING_SYNC_MODE_KEY, drawingSyncMode);
    localStore.set(DRAWING_SYNC_MODE_VERSION_KEY, DRAWING_SYNC_MODE_VERSION);
    if (drawingSyncModeNeedsMigration) {
      queueChartSettings(_get, set, {
        drawingSyncMode,
        drawingSyncModeVersion: DRAWING_SYNC_MODE_VERSION,
      });
    }
    if (symbolWritePending && symbol === remoteSymbol) {
      localStore.remove(CURRENT_SYMBOL_PENDING_KEY);
    } else if (symbolWritePending) {
      queueChartSettings(_get, set, { symbol });
    }
  },
);

// Applies the opaque chart slice stored inside a Phase 12 layout. This is a
// view restore, so it deliberately does not rewrite the standalone drawing and
// indicator resources on the backend.
export const applySavedChartLayoutAtom = atom(
  null,
  (
    get,
    set,
    snapshot: {
      symbol?: string;
      timeframe?: Timeframe;
      drawings: Drawing[];
      indicators: IndicatorConfig[];
      persistSymbol?: boolean;
    },
  ) => {
    const symbol = normalizeChartSymbol(snapshot.symbol) || get(symbolAtom);
    const timeframe = snapshot.timeframe ?? get(timeframeAtom);
    const marketChanged = symbol !== get(symbolAtom) || timeframe !== get(timeframeAtom);
    set(symbolAtom, symbol);
    if (snapshot.persistSymbol !== false) {
      localStore.set(CURRENT_SYMBOL_KEY, symbol);
      if (get(backendSessionAtom)) {
        localStore.set(CURRENT_SYMBOL_PENDING_KEY, true);
      }
      queueChartSettings(get, set, { symbol });
    }
    set(timeframeAtom, timeframe);
    const snapshotDrawings = decodeDrawingsAtBoundary(symbol, snapshot.drawings ?? [], "layout");
    const context = syncContext(get, symbol);
    const localGlobal = readDrawingRegistry(symbol).filter(
      (drawing) => !drawing.sync || drawing.sync.mode === "global",
    );
    const byId = new Map(snapshotDrawings.map((drawing) => [drawing.id, drawing]));
    for (const drawing of localGlobal) byId.set(drawing.id, drawing);
    const drawings = selectDrawingsForSyncContext([...byId.values()], context);
    const layoutIndicators = scopeLegacyIndicatorsToChart(
      snapshot.indicators ?? [],
      indicatorContext(get),
    );
    const indicatorRegistry = mergeIndicatorLayoutRegistry(
      get(indicatorsAtom),
      layoutIndicators,
      context.layoutId,
    );
    set(drawingsAtom, structuredClone(drawings));
    set(indicatorsAtom, structuredClone(indicatorRegistry));
    persistLocalDrawings(get, symbol, drawings);
    localStore.set("indicators", indicatorRegistry);
    set(selectedDrawingIdAtom, null);
    set(selectedDrawingIdsAtom, new Set());
    set(editingIndicatorIdAtom, null);
    if (marketChanged) {
      set(candlesAtom, []);
      set(loadingAtom, true);
    }
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
  symbol = normalizeChartSymbol(symbol);
  if (!symbol || symbol === _get(symbolAtom)) return;
  drawingLoadGuard.cancel();
  set(symbolAtom, symbol);
  localStore.set(CURRENT_SYMBOL_KEY, symbol);
  if (_get(backendSessionAtom)) {
    localStore.set(CURRENT_SYMBOL_PENDING_KEY, true);
  }
  queueChartSettings(_get, set, { symbol });
  set(candlesAtom, []);
  set(loadingAtom, true);
  const registry = decodeDrawingsAtBoundary(
    symbol,
    localStore.get<unknown>(drawingsKey(symbol), []),
    "local",
  );
  set(drawingsAtom, selectDrawingsForSyncContext(registry, syncContext(_get, symbol)));
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

export const setChartTimeZoneAtom = atom(
  null,
  (_get, set, value: ChartTimeZoneId) => {
    const timeZone = normalizeChartTimeZone(value);
    set(chartTimeZoneAtom, timeZone);
    set(
      resolvedChartTimeZoneAtom,
      timeZone === EXCHANGE_TIME_ZONE_ID ? "UTC" : timeZone,
    );
    localStore.set(CHART_TIME_ZONE_STORAGE_KEY, timeZone);
    queueChartSettings(_get, set, { timeZone });
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

export const setKeepDrawingModeAtom = atom(null, (_get, set, enabled: boolean) => {
  const next = { ..._get(drawingToolPreferencesAtom), keepDrawing: enabled };
  commitDrawingToolPreferences(_get, set, next);
});

export const setDrawingMagnetEnabledAtom = atom(null, (_get, set, enabled: boolean) => {
  const next = { ..._get(drawingToolPreferencesAtom), magnetEnabled: enabled };
  commitDrawingToolPreferences(_get, set, next);
});

export const setDrawingMagnetModeAtom = atom(null, (_get, set, mode: DrawingMagnetMode) => {
  const next = {
    ..._get(drawingToolPreferencesAtom),
    magnetEnabled: true,
    magnetMode: mode,
  };
  commitDrawingToolPreferences(_get, set, next);
});

export const setDrawingSnapToIndicatorsAtom = atom(null, (_get, set, enabled: boolean) => {
  const next = {
    ..._get(drawingToolPreferencesAtom),
    snapToIndicators: enabled,
  };
  commitDrawingToolPreferences(_get, set, next);
});

export const selectEmojiPickerItemAtom = atom(
  null,
  (_get, set, requested: EmojiPickerSelection) => {
    const selection = normalizeEmojiRecents([requested])[0];
    if (!selection) return;
    const current = _get(drawingToolPreferencesAtom);
    const next: DrawingToolPreferences = {
      ...current,
      toolDefaults: {
        ...current.toolDefaults,
        emoji: {
          ...current.toolDefaults.emoji,
          text: selection.value,
        },
      },
      emojiSelection: selection,
      emojiRecents: pushEmojiRecent(current.emojiRecents, selection),
    };
    commitDrawingToolPreferences(_get, set, next);
  },
);

export const saveDrawingToolDefaultsAtom = atom(null, (_get, set, drawing: Drawing) => {
  const definition = getDrawingToolManifestEntry(drawing.tool);
  if (!definition.persistent) return;
  const current = _get(drawingToolPreferencesAtom);
  const next: DrawingToolPreferences = {
    ...current,
    toolDefaults: {
      ...current.toolDefaults,
      [drawing.tool]: pickDrawingToolDefaults(drawing),
    },
  };
  commitDrawingToolPreferences(_get, set, next);
});

export interface AddDrawingRequest {
  drawing: Drawing;
  positionCreation?: PositionDrawingCreationOptions;
}

function isAddDrawingRequest(
  input: Drawing | AddDrawingRequest,
): input is AddDrawingRequest {
  return Object.prototype.hasOwnProperty.call(input, "drawing");
}

export const addDrawingAtom = atom(
  null,
  (_get, set, input: Drawing | AddDrawingRequest) => {
  let request: AddDrawingRequest | null = null;
  let d: Drawing;
  if (isAddDrawingRequest(input)) {
    request = input;
    d = input.drawing;
  } else {
    d = input;
  }
  const top = _get(drawingsAtom).reduce(
    (m, x) => Math.max(m, x.zIndex ?? 0),
    0,
  );
  let drawing: Drawing = {
    visible: true,
    locked: false,
    zIndex: top + 1,
    ...d,
    id: d.id || uid("dw"),
    points: d.points ? d.points.map((p) => ({ ...p })) : [],
    clientRevision: (d.clientRevision ?? 0) + 1,
    sync: d.sync ?? drawingSyncBinding(_get(newDrawingSyncModeAtom), syncContext(_get)),
  };
  // Long/Short position tools: a single click only gives the entry point.
  // Auto-expand to a TradingView-style 3-point box — points[0]=entry,
  // points[1]={rightEdgeTime, targetPrice}, points[2]={rightEdgeTime, stopPrice}
  // — so the profit/risk zones are immediately visible and draggable.
  const positionSide = getDrawingToolPositionSide(drawing.tool);
  if (positionSide && drawing.points.length === 1) {
    const candles = _get(candlesAtom);
    // Width means 20 bars on the active chart. The last two samples may straddle
    // a market/session gap (or belong to a replay fixture), so their wall-clock
    // delta is not a reliable bar interval.
    const timeframeInterval = TF_SECONDS[_get(timeframeAtom)];
    const observedInterval = candles.length >= 2
      ? candles[candles.length - 1].time - candles[candles.length - 2].time
      : 3600;
    const interval = resolveCandleBarIntervalSeconds(
      candles,
      timeframeInterval,
      observedInterval,
    );
    const symbol = _get(symbolAtom);
    const symbolInfo = positionLotSymbolInfo(
      symbol,
      _get(mt5SymbolInfoAtom)[symbol],
    );
    const requestedCreation = request?.positionCreation;
    const barCount = requestedCreation?.barCount ?? 20;
    const hasChartTimeline =
      Number.isFinite(requestedCreation?.entryTime) &&
      Number.isFinite(requestedCreation?.rightEdgeTime) &&
      Number(requestedCreation?.rightEdgeTime) > Number(requestedCreation?.entryTime);
    const timeline = hasChartTimeline
      ? {
          entryTime: Number(requestedCreation?.entryTime),
          rightEdgeTime: Number(requestedCreation?.rightEdgeTime),
        }
      : resolvePositionCreationTimeline(
          drawing.points[0].time,
          interval,
          barCount,
          candles,
        );
    drawing = {
      ...drawing,
      points: [{ ...drawing.points[0], time: timeline.entryTime }],
    };
    const initialization = initializePositionDrawing(
      drawing,
      interval,
      symbolInfo.tickSize ?? symbolInfo.point,
      {
        ...requestedCreation,
        entryTime: timeline.entryTime,
        rightEdgeTime: timeline.rightEdgeTime,
      },
    );
    if (!initialization) return;
    drawing = initialization.drawing;
    const marketPrice = latestMarketPrice(candles);
    const prefill = buildOrderPrefillFromPositionDrawing(drawing, marketPrice, {
      symbolInfo,
    });
    if (prefill) {
      set(setOrderPrefillAtom, prefill);
      const language = _get(appLanguageAtom);
      const sideLabel = translate(
        language,
        positionSide === "long" ? "position.side.long" : "position.side.short",
      );
      set(pushToastAtom, {
        title: translate(language, "position.prefill.title", { side: sideLabel }),
        message: translate(language, "position.prefill.message"),
        variant: "info",
        duration: 7000,
      });
      set(
        logAtom,
        "info",
        `Trade ticket filled from ${positionSide === "long" ? "Long" : "Short"} Position`,
      );
    }
  }
  const drawings = [..._get(drawingsAtom), drawing];
  set(drawingsAtom, drawings);
  // Keep Drawing is a global creation preference. When disabled, retain the
  // established one-shot behavior and return to Cursor after placement.
  if (!_get(drawingToolPreferencesAtom).keepDrawing) set(activeToolAtom, "crosshair");
  set(selectedDrawingIdAtom, drawing.id);
  set(selectedDrawingIdsAtom, new Set([drawing.id]));
  const symbol = _get(symbolAtom);
  persistLocalDrawings(_get, symbol, drawings);
  queueDrawingUpsert(_get, set, symbol, drawing);
});

export const updateDrawingAtom = atom(
  null,
  (_get, set, arg: { id: string; patch: Partial<Drawing> }) => {
    const { id, patch } = arg;
    let updatedDrawing: Drawing | null = null;
    const drawings = _get(drawingsAtom).map((d) => {
      if (d.id !== id) return d;
      updatedDrawing = {
        ...d,
        ...patch,
        clientRevision: (d.clientRevision ?? 0) + 1,
      };
      return updatedDrawing;
    });
    set(drawingsAtom, drawings);
    const symbol = _get(symbolAtom);
    persistLocalDrawings(_get, symbol, drawings);
    if (updatedDrawing) queueDrawingUpsert(_get, set, symbol, updatedDrawing);
    syncPositionDrawingPrefill(_get, set, id, patch, updatedDrawing);
  },
);

/**
 * Publish and persist several drawing changes as one atomic collection write.
 * Each updated drawing still advances its client revision and enters the sync
 * queue, matching updateDrawingAtom without exposing intermediate states.
 */
export const batchUpdateDrawingsAtom = atom(
  null,
  (_get, set, updates: readonly DrawingPatchUpdate[]) => {
    const result = applyDrawingBatchUpdates(_get(drawingsAtom), updates);
    if (result.updatedById.size === 0) return;

    set(drawingsAtom, result.drawings);
    const symbol = _get(symbolAtom);
    persistLocalDrawings(_get, symbol, result.drawings);

    // The sync queue coalesces by drawing id, so enqueue only each final value.
    const queued = new Set<string>();
    for (const { id } of updates) {
      if (queued.has(id)) continue;
      const drawing = result.updatedById.get(id);
      if (!drawing) continue;
      queued.add(id);
      queueDrawingUpsert(_get, set, symbol, drawing);
    }

    // Process in request order so selected/active ticket ownership follows the
    // same observable semantics as sequential singular updates.
    for (const { id, patch } of updates) {
      syncPositionDrawingPrefill(
        _get,
        set,
        id,
        patch,
        result.updatedById.get(id),
      );
    }
  },
);

export const removeDrawingAtom = atom(null, (_get, set, id: string) => {
  const symbol = _get(symbolAtom);
  const removed = _get(drawingsAtom).find((d) => d.id === id);
  const drawings = _get(drawingsAtom).filter((d) => d.id !== id);
  set(drawingsAtom, drawings);
  const selectedIds = new Set(_get(selectedDrawingIdsAtom));
  selectedIds.delete(id);
  set(selectedDrawingIdsAtom, selectedIds);
  set(selectedDrawingIdAtom, selectedIds.size === 1 ? [...selectedIds][0] : null);
  persistLocalDrawings(_get, symbol, drawings);
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
    serverRevision: undefined,
    clientRevision: 1,
    zIndex: top + 1,
    points: src.points.map((p) => ({ ...p })),
  };
  const drawings = [..._get(drawingsAtom), copy];
  set(drawingsAtom, drawings);
  set(selectedDrawingIdAtom, copy.id);
  set(selectedDrawingIdsAtom, new Set([copy.id]));
  const symbol = _get(symbolAtom);
  persistLocalDrawings(_get, symbol, drawings);
  queueDrawingUpsert(_get, set, symbol, copy);
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

export const setSelectedDrawingIdsAtom = atom(
  null,
  (_get, set, ids: Iterable<string>) => {
    const selected = new Set(ids);
    set(selectedDrawingIdsAtom, selected);
    set(selectedDrawingIdAtom, selected.size === 1 ? [...selected][0] : null);
  },
);

export const selectAllAtom = atom(null, (_get, set) => {
  const ids = new Set(
    _get(drawingsAtom)
      .filter((d) => d.visible !== false)
      .map((d) => d.id),
  );
  set(selectedDrawingIdsAtom, ids);
  set(selectedDrawingIdAtom, null);
});

export const addIndicatorAtom = atom(null, (_get, set, definition: IndicatorRuntimeDefinition) => {
  const cfg = bindIndicatorToChart(
    indicatorConfigFromDefinition(definition, uid("ind")),
    indicatorContext(_get),
  );
  const indicators = [..._get(indicatorsAtom), cfg];
  commitIndicators(_get, set, indicators);
});

export const toggleIndicatorAtom = atom(
  null,
  (_get, set, definition: IndicatorRuntimeDefinition) => {
    const registry = _get(indicatorsAtom);
    const current = _get(activeIndicatorsAtom);
    const matches = current.filter(
      (indicator) => indicator.type === definition.type,
    );
    const has = matches.length > 0;
    const indicators = has
      ? registry.filter(
          (indicator) => !matches.some((match) => match.id === indicator.id),
        )
      : [
          ...registry,
          bindIndicatorToChart(
            indicatorConfigFromDefinition(definition, uid("ind")),
            indicatorContext(_get),
          ),
        ];
    if (has) {
      matches.forEach((indicator) =>
        queueIndicatorDelete(_get, set, indicator.id),
      );
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
  const active = _get(activeIndicatorsAtom);
  const activeIds = new Set(active.map((indicator) => indicator.id));
  active.forEach((indicator) =>
    queueIndicatorDelete(_get, set, indicator.id),
  );
  const indicators = _get(indicatorsAtom).filter(
    (indicator) => !activeIds.has(indicator.id),
  );
  commitIndicators(_get, set, indicators);
});

async function sourceIndicatorDefinition(
  sourceCode: string,
  indicatorType?: string,
): Promise<IndicatorRuntimeDefinition> {
  try {
    return await loadIndicatorDefinition({ indicatorType, sourceCode });
  } catch {
    return {
      type: indicatorType || "source",
      name: "Untitled script",
      overlay: true,
      inputs: [],
      styles: [],
      requiresHistoryContext: false,
      sourceAvailable: true,
    };
  }
}

async function customIndicatorConfig(
  script: Pick<CustomIndicatorScript, "id" | "name" | "sourceCode">,
  id = uid("ind"),
): Promise<IndicatorConfig> {
  const definition = await sourceIndicatorDefinition(
    script.sourceCode,
    `script:${script.id}`,
  );
  return indicatorConfigFromDefinition(definition, id, {
    name: script.name.trim() || definition.name,
    scriptId: script.id,
    sourceCode: script.sourceCode,
  });
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
    const definition = await sourceIndicatorDefinition(arg.sourceCode);
    const now = Date.now();
    const existing = arg.id
      ? _get(pineScriptsAtom).find((item) => item.id === arg.id)
      : undefined;
    const script: CustomIndicatorScript = {
      id: existing?.id ?? uid("pine"),
      name: arg.name.trim() || definition.name || "Untitled script",
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
      indicator.scriptId === script.id
        ? {
            ...indicator,
            name: script.name,
            sourceCode: script.sourceCode,
            separatePane: !definition.overlay,
            requiresHistoryContext: definition.requiresHistoryContext,
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
    const cfg = await customIndicatorConfig(fullScript);
    const registry = _get(indicatorsAtom);
    const current = _get(activeIndicatorsAtom);
    const existing = current.find(
      (item) => item.scriptId === fullScript.id,
    );
    const indicators = existing
      ? registry.map((item) =>
          item.id === existing.id
            ? {
                ...cfg,
                id: existing.id,
                visible: true,
                inputValues: existing.inputValues,
                styleValues: existing.styleValues,
                chartScope: existing.chartScope,
              }
            : item,
        )
      : [...registry, bindIndicatorToChart(cfg, indicatorContext(_get))];
    persistIndicators(_get, set, indicators);
  },
);

export const addCustomIndicatorFromSourceAtom = atom(
  null,
  async (
    _get,
    set,
    arg: { name: string; sourceCode: string; scriptId?: string | null },
  ) => {
    const definition = await sourceIndicatorDefinition(arg.sourceCode);
    const cfg = await customIndicatorConfig({
      id: arg.scriptId ?? uid("pine-draft"),
      name: arg.name.trim() || definition.name,
      sourceCode: arg.sourceCode,
    });
    const registry = _get(indicatorsAtom);
    const current = _get(activeIndicatorsAtom);
    const existing = arg.scriptId
      ? current.find(
          (item) => item.scriptId === arg.scriptId,
        )
      : undefined;
    const indicators = existing
      ? registry.map((item) =>
          item.id === existing.id
            ? {
                ...cfg,
                id: existing.id,
                inputValues: existing.inputValues,
                styleValues: existing.styleValues,
                chartScope: existing.chartScope,
              }
            : item,
        )
      : [...registry, bindIndicatorToChart(cfg, indicatorContext(_get))];
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
      ...pickDrawingTemplateStyle(d),
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
    const drawing = _get(drawingsAtom).find((candidate) => candidate.id === id);
    if (!drawing || template.family !== styleFamily(drawing.tool)) return;
    const patch = applyDrawingTemplateStyle(drawing.tool, template);
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
  const storedSymbol = normalizeChartSymbol(
    localStore.get<unknown>(CURRENT_SYMBOL_KEY, ""),
  );
  if (storedSymbol && storedSymbol !== _get(symbolAtom)) {
    set(symbolAtom, storedSymbol);
    set(candlesAtom, []);
    set(loadingAtom, true);
  }
  const symbol = _get(symbolAtom);
  const registry = decodeDrawingsAtBoundary(
    symbol,
    localStore.get<unknown>(drawingsKey(symbol), []),
    "local",
  );
  set(
    drawingsAtom,
    selectDrawingsForSyncContext(registry, syncContext(_get, symbol)),
  );
  const indicators = scopeLegacyIndicatorsToChart(
    localStore.get<IndicatorConfig[]>("indicators", []),
    indicatorContext(_get),
  );
  set(indicatorsAtom, indicators);
  localStore.set("indicators", indicators);
  set(
    pineScriptsAtom,
    localStore.get<CustomIndicatorScript[]>(PINE_SCRIPTS_KEY, []),
  );
  set(
    drawingTemplatesAtom,
    decodeDrawingTemplateList(localStore.get<unknown>(TEMPLATES_KEY, [])),
  );
  set(
    drawingToolPreferencesAtom,
    decodeDrawingToolPreferences(
      localStore.get<unknown>(DRAWING_TOOL_PREFERENCES_KEY, null),
    ),
  );
  const storedTimeZone = readStoredChartTimeZone();
  set(chartTimeZoneAtom, storedTimeZone);
  set(
    resolvedChartTimeZoneAtom,
    storedTimeZone === EXCHANGE_TIME_ZONE_ID ? "UTC" : storedTimeZone,
  );
  const { mode: syncMode } = resolveDrawingSyncModeSetting(
    localStore.get<unknown>(DRAWING_SYNC_MODE_KEY, DEFAULT_DRAWING_SYNC_MODE),
    localStore.get<unknown>(DRAWING_SYNC_MODE_VERSION_KEY, 0),
  );
  set(
    newDrawingSyncModeAtom,
    syncMode,
  );
  localStore.set(DRAWING_SYNC_MODE_KEY, syncMode);
  localStore.set(DRAWING_SYNC_MODE_VERSION_KEY, DRAWING_SYNC_MODE_VERSION);
});

export const resetChartWorkspaceToDefaultsAtom = atom(
  null,
  (_get, set, options?: { clearLocal?: boolean }) => {
    chartSettingsSync.cancelPending();
    const symbol = _get(symbolAtom);
    for (const drawing of _get(drawingsAtom)) {
      queueDrawingDelete(_get, set, symbol, drawing);
    }
    drawingSyncQueue.preserveAndCancel();
    if (indicatorSyncTimer) {
      clearTimeout(indicatorSyncTimer);
      indicatorSyncTimer = null;
    }
    pendingIndicatorUpserts.clear();
    pendingIndicatorDeletes.clear();

    set(drawingsAtom, []);
    set(drawingTemplatesAtom, []);
    set(indicatorsAtom, []);
    set(pineScriptsAtom, []);
    set(pineEditorScriptIdAtom, null);
    set(pineEditorTitleAtom, "Untitled script");
    set(pineEditorSourceAtom, DEFAULT_PINE_SOURCE);
    set(activeToolAtom, "crosshair");
    set(drawColorAtom, "#2962ff");
    set(chartTimeZoneAtom, EXCHANGE_TIME_ZONE_ID);
    set(resolvedChartTimeZoneAtom, "UTC");
    set(drawingToolPreferencesAtom, structuredClone(EMPTY_DRAWING_TOOL_PREFERENCES));
    set(newDrawingSyncModeAtom, DEFAULT_DRAWING_SYNC_MODE);
    set(selectedDrawingIdAtom, null);
    set(selectedDrawingIdsAtom, new Set());
    set(editingIndicatorIdAtom, null);
    set(editingDrawingIdAtom, null);
    set(crosshairAtom, null);
    set(orderPrefillAtom, null);
    if (options?.clearLocal !== false) clearLocalChartWorkspace();
  },
);

// ---------------------------------------------------------------------------
// Derived read-only atom (for compatibility / getChartState)
// ---------------------------------------------------------------------------

export const chartStateAtom = atom((get) => ({
  symbol: get(symbolAtom),
  timeframe: get(timeframeAtom),
  timeZone: get(chartTimeZoneAtom),
  candles: get(candlesAtom),
  loading: get(loadingAtom),
  drawings: get(drawingsAtom),
  indicators: get(activeIndicatorsAtom),
  pineScripts: get(pineScriptsAtom),
  pineEditorScriptId: get(pineEditorScriptIdAtom),
  pineEditorTitle: get(pineEditorTitleAtom),
  pineEditorSource: get(pineEditorSourceAtom),
  activeTool: get(activeToolAtom),
  drawColor: get(drawColorAtom),
  drawingToolPreferences: get(drawingToolPreferencesAtom),
  drawingSyncMode: get(newDrawingSyncModeAtom),
  selectedDrawingId: get(selectedDrawingIdAtom),
  selectedDrawingIds: get(selectedDrawingIdsAtom),
  editingIndicatorId: get(editingIndicatorIdAtom),
  crosshair: get(crosshairAtom),
}));

// ---------------------------------------------------------------------------
// Non-React helper
// ---------------------------------------------------------------------------

export function getChartState() {
  return getDefaultStore().get(chartStateAtom);
}

/** Flush the latest chart preference while the authenticated session still exists. */
export async function flushChartSettings(): Promise<void> {
  await chartSettingsSync.flush();
  const symbolPending = localStore.get<boolean>(
    CURRENT_SYMBOL_PENDING_KEY,
    false,
  );
  const symbol = normalizeChartSymbol(
    localStore.get<unknown>(CURRENT_SYMBOL_KEY, ""),
  );
  if (!symbolPending || !symbol) return;

  // The generic queue reports errors through its callback so normal controls
  // remain non-blocking. Sign-out is a durability boundary: issue one final
  // idempotent write that can reject before the backend session is destroyed.
  await patchSettings({ chart: { symbol } });
  localStore.remove(CURRENT_SYMBOL_PENDING_KEY);
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
