"use client";
/**
 * Alert Store (Phase 2) — TradingView-style price alerts.
 *
 * Converted from Zustand to Jotai atoms. Each state field is an individual
 * atom; each action is a write atom. A compatibility `useAlertStore` hook
 * and `getAlertState()` for non-React code keep the existing API.
 */
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { uid } from "@/utils/id";
import { localStore } from "@/services/storage";

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
});

// ── Write atoms: bulk / settings ─────────────────────────────────────────────

export const clearTriggeredAtom = atom(null, (_get, set) => {
  set(triggeredAlertsAtom, []);
  persist();
});

export const clearHistoryAtom = atom(null, (_get, set) => {
  set(historyAtom, []);
  persist();
});

export const setSettingsAtom = atom(
  null,
  (get, set, patch: Partial<AlertSettings>) => {
    set(settingsAtom, { ...get(settingsAtom), ...patch });
    persist();
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

// ── Write atoms: backward-compat (chart context menu) ────────────────────────

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
  set(alertsAtom, []);
  persist();
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
