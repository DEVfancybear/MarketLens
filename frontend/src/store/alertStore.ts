"use client";
/**
 * Alert Store (Phase 2) — TradingView-style price alerts.
 *
 * Converted from Zustand to Jotai atoms. Each state field is an individual
 * atom; each action is a write atom. A compatibility `useAlertStore` hook
 * and `getAlertState()` for non-React code keep the existing API.
 */
import { atom, useAtomValue, type Getter } from "jotai";
import { getDefaultStore } from "jotai";
import { uid } from "@/utils/id";
import { localStore } from "@/services/storage";
import { backendSessionAtom } from "@/store/authStore";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import {
  backendAlertEventToLocal,
  backendAlertToLocal,
  clearAlertHistory as clearRemoteAlertHistory,
  createAlert as createRemoteAlert,
  deleteAlert as deleteRemoteAlert,
  localAlertToCreate,
  localAlertToPatch,
  patchAlert as patchRemoteAlert,
  triggerAlert as triggerRemoteAlert,
  type BackendAlertSnapshot,
} from "@/services/api/resources/alertsApi";
import { patchSettings } from "@/services/api/resources/settingsApi";

/** Incremented on every mutation so external subscribers (e.g. AlertOverlay canvas) can react. */
export const alertTickAtom = atom<number>(0);

export type AlertCondition = "above" | "below" | "crossUp" | "crossDown";
export type AlertStatus = "active" | "triggered";

export interface Alert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  price: number;
  status: AlertStatus;
  enabled: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
  triggeredAt?: number;
  triggerPrice?: number;
  note?: string;
  recurring: boolean;
  sound: boolean;
  browser: boolean;
  push: boolean;
  telegram: boolean;
  discord: boolean;
}

export interface AlertHistoryEntry {
  id: string;
  alertId: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  triggerPrice: number;
  triggerTime: number;
}

export interface AlertSettings {
  toast: boolean;
  sound: boolean;
  browser: boolean;
  push: boolean;
  telegram: boolean;
  discord: boolean;
}

export interface CreateAlertInput {
  symbol: string;
  condition: AlertCondition;
  price: number;
  note?: string;
  recurring?: boolean;
}

/** Human-readable operator for a condition. */
export const CONDITION_LABEL: Record<AlertCondition, string> = {
  above: "Price above",
  below: "Price below",
  crossUp: "Crossing up",
  crossDown: "Crossing down",
};

export const CONDITION_SYMBOL: Record<AlertCondition, string> = {
  above: "≥",
  below: "≤",
  crossUp: "↗",
  crossDown: "↘",
};

const STORAGE_KEY = "alerts";
const MAX_HISTORY = 200;
const MAX_TRIGGERED = 50;
/** Recurring alerts re-arm after this gap so one cross doesn't fire every tick. */
export const RECURRING_REARM_MS = 60_000;

interface PersistShape {
  alerts: Alert[];
  triggeredAlerts: Alert[];
  history: AlertHistoryEntry[];
  settings: AlertSettings;
}

const DEFAULT_SETTINGS: AlertSettings = {
  toast: true,
  sound: true,
  browser: false,
  push: false,
  telegram: false,
  discord: false,
};

// ── Persistence helper ───────────────────────────────────────────────────────

function persist() {
  const store = getDefaultStore();
  const shape: PersistShape = {
    alerts: store.get(alertsAtom),
    triggeredAlerts: store.get(triggeredAlertsAtom),
    history: store.get(historyAtom),
    settings: store.get(settingsAtom),
  };
  localStore.set(STORAGE_KEY, shape);
  // Bump tick so external subscribers (AlertOverlay canvas) re-render.
  store.set(alertTickAtom, store.get(alertTickAtom) + 1);
}

const alertSyncQueues = new Map<string, Promise<void>>();
let historySyncQueue: Promise<void> = Promise.resolve();
let settingsSyncQueue: Promise<void> = Promise.resolve();

function syncEnabled(get: Getter): boolean {
  return get(backendSessionAtom);
}

function reportSyncError(action: string, error: unknown): void {
  reportFrontendError(error, {
    title: "Alert sync failed",
    logPrefix: `Alert sync failed (${action})`,
  });
}

function queueAlertSync(
  get: Getter,
  alertID: string,
  action: string,
  request: () => Promise<unknown>,
): void {
  if (!syncEnabled(get)) return;
  const previous = alertSyncQueues.get(alertID) ?? Promise.resolve();
  let tracked: Promise<void>;
  tracked = previous
    .catch(() => undefined)
    .then(request)
    .then(() => undefined)
    .catch((error) => reportSyncError(action, error))
    .finally(() => {
      if (alertSyncQueues.get(alertID) === tracked) {
        alertSyncQueues.delete(alertID);
      }
    });
  alertSyncQueues.set(alertID, tracked);
}

function queueHistoryClear(get: Getter): void {
  if (!syncEnabled(get)) return;
  const pendingAlertMutations = [...alertSyncQueues.values()];
  historySyncQueue = Promise.allSettled([
    historySyncQueue,
    ...pendingAlertMutations,
  ])
    .then(clearRemoteAlertHistory)
    .catch((error) => reportSyncError("clear history", error));
}

function queueSettingsSync(get: Getter): void {
  if (!syncEnabled(get)) return;
  const notifications = { ...get(settingsAtom) };
  settingsSyncQueue = settingsSyncQueue
    .catch(() => undefined)
    .then(() => patchSettings({ notifications }))
    .then(() => undefined)
    .catch((error) => reportSyncError("notification settings", error));
}

// ── State atoms ──────────────────────────────────────────────────────────────
export const alertsAtom = atom<Alert[]>([]);
export const triggeredAlertsAtom = atom<Alert[]>([]);
export const historyAtom = atom<AlertHistoryEntry[]>([]);
export const settingsAtom = atom<AlertSettings>(DEFAULT_SETTINGS);
export const selectedAlertIdAtom = atom<string | null>(null);
export const editingAlertIdAtom = atom<string | null>(null);

// ── Write atoms: CRUD ────────────────────────────────────────────────────────

export const createAlertAtom = atom(
  null,
  (get, set, input: CreateAlertInput): Alert => {
    const settings = get(settingsAtom);
    const alert: Alert = {
      id: uid("alert"),
      symbol: input.symbol,
      condition: input.condition,
      price: input.price,
      status: "active",
      enabled: true,
      locked: false,
      createdAt: Date.now() / 1000,
      updatedAt: Date.now() / 1000,
      note: input.note,
      recurring: input.recurring ?? false,
      sound: settings.sound,
      browser: settings.browser,
      push: settings.push,
      telegram: settings.telegram,
      discord: settings.discord,
    };
    set(alertsAtom, [alert, ...get(alertsAtom)]);
    persist();
    queueAlertSync(get, alert.id, "create", () =>
      createRemoteAlert(localAlertToCreate(alert)),
    );
    return alert;
  },
);

export const updateAlertAtom = atom(
  null,
  (get, set, id: string, patch: Partial<Omit<Alert, "id">>) => {
    set(
      alertsAtom,
      get(alertsAtom).map((a) =>
        a.id === id ? { ...a, ...patch, updatedAt: Date.now() / 1000 } : a,
      ),
    );
    set(
      triggeredAlertsAtom,
      get(triggeredAlertsAtom).map((a) =>
        a.id === id ? { ...a, ...patch, updatedAt: Date.now() / 1000 } : a,
      ),
    );
    persist();
    const current =
      get(alertsAtom).find((alert) => alert.id === id) ??
      get(triggeredAlertsAtom).find((alert) => alert.id === id);
    if (current) {
      queueAlertSync(get, id, "update", () =>
        patchRemoteAlert(id, localAlertToPatch(current)),
      );
    }
  },
);

export const deleteAlertAtom = atom(null, (get, set, id: string) => {
  set(
    alertsAtom,
    get(alertsAtom).filter((a) => a.id !== id),
  );
  set(
    triggeredAlertsAtom,
    get(triggeredAlertsAtom).filter((a) => a.id !== id),
  );
  if (get(selectedAlertIdAtom) === id) set(selectedAlertIdAtom, null);
  if (get(editingAlertIdAtom) === id) set(editingAlertIdAtom, null);
  persist();
  queueAlertSync(get, id, "delete", () => deleteRemoteAlert(id));
});

export const duplicateAlertAtom = atom(
  null,
  (get, set, id: string): Alert | undefined => {
    const src =
      get(alertsAtom).find((a) => a.id === id) ??
      get(triggeredAlertsAtom).find((a) => a.id === id);
    if (!src) return undefined;
    const clone: Alert = {
      ...src,
      id: uid("alert"),
      status: "active",
      createdAt: Date.now() / 1000,
      updatedAt: Date.now() / 1000,
      triggeredAt: undefined,
      triggerPrice: undefined,
    };
    set(alertsAtom, [clone, ...get(alertsAtom)]);
    set(selectedAlertIdAtom, clone.id);
    persist();
    queueAlertSync(get, clone.id, "duplicate", () =>
      createRemoteAlert(localAlertToCreate(clone)),
    );
    return clone;
  },
);

// ── Write atoms: selection / editing ─────────────────────────────────────────

export const selectAlertAtom = atom(null, (_get, set, id: string | null) => {
  set(selectedAlertIdAtom, id);
});

export const editAlertAtom = atom(null, (_get, set, id: string | null) => {
  set(editingAlertIdAtom, id);
});

// ── Write atoms: lifecycle ───────────────────────────────────────────────────

export const triggerAlertAtom = atom(
  null,
  (get, set, id: string, triggerPrice: number): Alert | undefined => {
    const alert = get(alertsAtom).find((a) => a.id === id);
    if (!alert) return undefined;
    const now = Date.now() / 1000;
    const fired: Alert = {
      ...alert,
      status: "triggered",
      triggeredAt: now,
      triggerPrice,
    };
    const entry: AlertHistoryEntry = {
      id: uid("alh"),
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      targetPrice: alert.price,
      triggerPrice,
      triggerTime: now,
    };

    set(historyAtom, [entry, ...get(historyAtom)].slice(0, MAX_HISTORY));

    if (alert.recurring) {
      // Stay armed; just stamp the last trigger time (engine re-arm gate).
      set(
        alertsAtom,
        get(alertsAtom).map((a) =>
          a.id === id ? { ...a, triggeredAt: now, triggerPrice } : a,
        ),
      );
    } else {
      // One-time: move active → triggered.
      set(
        alertsAtom,
        get(alertsAtom).filter((a) => a.id !== id),
      );
      set(
        triggeredAlertsAtom,
        [fired, ...get(triggeredAlertsAtom)].slice(0, MAX_TRIGGERED),
      );
    }
    persist();
    queueAlertSync(get, id, "trigger", () =>
      triggerRemoteAlert(id, triggerPrice),
    );
    return fired;
  },
);

export const resetAlertAtom = atom(null, (get, set, id: string) => {
  const fired = get(triggeredAlertsAtom).find((a) => a.id === id);
  if (!fired) return;
  const rearmed: Alert = {
    ...fired,
    status: "active",
    triggeredAt: undefined,
    triggerPrice: undefined,
  };
  set(
    triggeredAlertsAtom,
    get(triggeredAlertsAtom).filter((a) => a.id !== id),
  );
  set(alertsAtom, [rearmed, ...get(alertsAtom)]);
  persist();
  queueAlertSync(get, id, "re-arm", () =>
    patchRemoteAlert(id, { ...localAlertToPatch(rearmed), status: "active" }),
  );
});

// ── Write atoms: bulk / settings ─────────────────────────────────────────────

export const clearTriggeredAtom = atom(null, (get, set) => {
  const ids = get(triggeredAlertsAtom).map((alert) => alert.id);
  set(triggeredAlertsAtom, []);
  persist();
  for (const id of ids) {
    queueAlertSync(get, id, "clear triggered", () => deleteRemoteAlert(id));
  }
});

export const clearHistoryAtom = atom(null, (get, set) => {
  set(historyAtom, []);
  persist();
  queueHistoryClear(get);
});

export const setSettingsAtom = atom(
  null,
  (get, set, patch: Partial<AlertSettings>) => {
    set(settingsAtom, { ...get(settingsAtom), ...patch });
    persist();
    queueSettingsSync(get);
  },
);

// ── Write atoms: hydration ───────────────────────────────────────────────────

export const hydrateAtom = atom(null, (_get, set) => {
  const saved = localStore.get<PersistShape | null>(STORAGE_KEY, null);
  if (!saved) return;
  const migrate = (a: Alert): Alert => ({
    ...a,
    enabled: a.enabled ?? true,
    locked: a.locked ?? false,
    updatedAt: a.updatedAt ?? a.createdAt ?? Date.now() / 1000,
    sound: a.sound ?? true,
    browser: a.browser ?? false,
    push: a.push ?? false,
    telegram: a.telegram ?? false,
    discord: a.discord ?? false,
  });
  set(alertsAtom, (saved.alerts ?? []).map(migrate));
  set(triggeredAlertsAtom, (saved.triggeredAlerts ?? []).map(migrate));
  set(historyAtom, saved.history ?? []);
  set(settingsAtom, { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) });
});

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const applyRemoteNotificationSettingsAtom = atom(
  null,
  (get, set, payload: unknown) => {
    if (!isObject(payload)) return;

    const settings: AlertSettings = { ...get(settingsAtom) };
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AlertSettings>) {
      if (typeof payload[key] === "boolean") settings[key] = payload[key];
    }
    set(settingsAtom, settings);
    persist();
  },
);

export const applyRemoteAlertsAtom = atom(
  null,
  (get, set, snapshot: BackendAlertSnapshot) => {
    const localAlerts = get(alertsAtom);
    const localTriggered = get(triggeredAlertsAtom);
    const localHistory = get(historyAtom);
    const remoteEmpty =
      snapshot.alerts.length === 0 &&
      snapshot.triggeredAlerts.length === 0 &&
      snapshot.history.length === 0;

    // First backend sign-in migration: preserve the existing browser workspace
    // and idempotently upload it instead of letting an empty server snapshot
    // erase alerts created before Phase 10 persistence existed.
    if (
      remoteEmpty &&
      (localAlerts.length > 0 ||
        localTriggered.length > 0 ||
        localHistory.length > 0)
    ) {
      for (const alert of localAlerts) {
        queueAlertSync(get, alert.id, "migrate active", () =>
          createRemoteAlert(localAlertToCreate(alert)),
        );
      }
      for (const alert of localTriggered) {
        queueAlertSync(get, alert.id, "migrate triggered create", () =>
          createRemoteAlert(localAlertToCreate(alert)),
        );
        queueAlertSync(get, alert.id, "migrate triggered event", () =>
          triggerRemoteAlert(alert.id, alert.triggerPrice ?? alert.price),
        );
      }
      persist();
      return;
    }

    set(alertsAtom, snapshot.alerts.map(backendAlertToLocal));
    set(
      triggeredAlertsAtom,
      snapshot.triggeredAlerts.map(backendAlertToLocal),
    );
    set(historyAtom, snapshot.history.map(backendAlertEventToLocal));
    set(selectedAlertIdAtom, null);
    set(editingAlertIdAtom, null);
    persist();
  },
);

// ── Write atoms: backward-compat (chart context menu) ────────────────────────

export const resetAlertsToDefaultsAtom = atom(null, (_get, set) => {
	alertSyncQueues.clear();
  set(alertsAtom, []);
  set(triggeredAlertsAtom, []);
  set(historyAtom, []);
  set(settingsAtom, DEFAULT_SETTINGS);
  set(selectedAlertIdAtom, null);
  set(editingAlertIdAtom, null);
  localStore.remove(STORAGE_KEY);
  set(alertTickAtom, Date.now());
});

export const addAlertAtom = atom(
  null,
  (
    get,
    set,
    symbol: string,
    price: number,
    condition: AlertCondition = "crossUp",
  ): Alert => {
    return getDefaultStore().set(createAlertAtom, { symbol, condition, price });
  },
);

export const removeAlertAtom = atom(null, (get, set, id: string) => {
  set(deleteAlertAtom, id);
});

export const clearAlertsAtom = atom(null, (_get, set) => {
  const ids = _get(alertsAtom).map((alert) => alert.id);
  set(alertsAtom, []);
  persist();
  for (const id of ids) {
    queueAlertSync(_get, id, "clear active", () => deleteRemoteAlert(id));
  }
});

// ── Combined interface (for compatibility hook + getState) ───────────────────

interface AlertState {
  alerts: Alert[];
  triggeredAlerts: Alert[];
  history: AlertHistoryEntry[];
  settings: AlertSettings;
  selectedAlertId: string | null;
  editingAlertId: string | null;
}

export interface AlertActions {
  createAlert: (input: CreateAlertInput) => Alert;
  updateAlert: (id: string, patch: Partial<Omit<Alert, "id">>) => void;
  deleteAlert: (id: string) => void;
  duplicateAlert: (id: string) => Alert | undefined;
  selectAlert: (id: string | null) => void;
  editAlert: (id: string | null) => void;
  triggerAlert: (id: string, triggerPrice: number) => Alert | undefined;
  resetAlert: (id: string) => void;
  clearTriggered: () => void;
  clearHistory: () => void;
  setSettings: (patch: Partial<AlertSettings>) => void;
  hydrate: () => void;
  add: (symbol: string, price: number, condition?: AlertCondition) => Alert;
  remove: (id: string) => void;
  clear: () => void;
}

export type AlertStoreInterface = AlertState & AlertActions;

const alertStateAtom = atom<AlertState>((get) => ({
  alerts: get(alertsAtom),
  triggeredAlerts: get(triggeredAlertsAtom),
  history: get(historyAtom),
  settings: get(settingsAtom),
  selectedAlertId: get(selectedAlertIdAtom),
  editingAlertId: get(editingAlertIdAtom),
}));

const alertCombinedAtom = atom<AlertStoreInterface>((get) => {
  const state = get(alertStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    createAlert: (input) => store.set(createAlertAtom, input) as Alert,
    updateAlert: (id, patch) => store.set(updateAlertAtom, id, patch),
    deleteAlert: (id) => store.set(deleteAlertAtom, id),
    duplicateAlert: (id) =>
      store.set(duplicateAlertAtom, id) as Alert | undefined,
    selectAlert: (id) => store.set(selectAlertAtom, id),
    editAlert: (id) => store.set(editAlertAtom, id),
    triggerAlert: (id, triggerPrice) =>
      store.set(triggerAlertAtom, id, triggerPrice) as Alert | undefined,
    resetAlert: (id) => store.set(resetAlertAtom, id),
    clearTriggered: () => store.set(clearTriggeredAtom),
    clearHistory: () => store.set(clearHistoryAtom),
    setSettings: (patch) => store.set(setSettingsAtom, patch),
    hydrate: () => store.set(hydrateAtom),
    add: (symbol, price, condition?) =>
      store.set(addAlertAtom, symbol, price, condition) as Alert,
    remove: (id) => store.set(removeAlertAtom, id),
    clear: () => store.set(clearAlertsAtom),
  };
});

// ── Compatibility hook ───────────────────────────────────────────────────────
export function useAlertStore(): AlertStoreInterface;
export function useAlertStore<T>(
  selector: (state: AlertStoreInterface) => T,
): T;
export function useAlertStore<T>(
  selector?: (state: AlertStoreInterface) => T,
): AlertStoreInterface | T {
  const combined = useAtomValue(alertCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

// Static getState() for non-React code.
export function getAlertState(): AlertStoreInterface {
  return getDefaultStore().get(alertCombinedAtom);
}

/** Selector: all alerts that should render a live price line (active only). */
export const selectActiveAlerts = (s: AlertStoreInterface) => s.alerts;
