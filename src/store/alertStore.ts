'use client';
/**
 * Alert Store (Phase 2) — TradingView-style price alerts.
 *
 * Single source of truth for alert definitions, the alerts that have fired, and
 * an immutable trigger history. Pure state + actions; price evaluation lives in
 * the Alert Engine (`services/alertEngine.ts` + `hooks/useAlertEngine.ts`), which
 * reads prices from `marketDataStore` — this store never touches the network.
 *
 * Lifecycle of a one-time alert:  alerts → (condition met) → triggeredAlerts,
 * and a row is appended to `history`. `resetAlert` re-arms it (back to `alerts`).
 * A `recurring` alert stays in `alerts` and only appends history on each fire
 * (with a short re-arm so it doesn't spam every tick).
 *
 * Persisted to localStorage (key `alerts`); hydrated once on the client.
 */
import { create } from 'zustand';
import { uid } from '@/utils/id';
import { localStore } from '@/services/storage';

export type AlertCondition = 'above' | 'below' | 'crossUp' | 'crossDown';
export type AlertStatus = 'active' | 'triggered';

export interface Alert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  /** Target price. (Kept as `price` for backward-compat with the chart overlay.) */
  price: number;
  status: AlertStatus;
  /** Disabled alerts render dimmed and are skipped by the engine. */
  enabled: boolean;
  /** Locked alerts cannot be dragged or deleted from the chart. */
  locked: boolean;
  createdAt: number; // epoch seconds
  triggeredAt?: number; // epoch seconds
  triggerPrice?: number;
  note?: string;
  /** Re-arm after firing ("Every time") vs fire once ("Only once"). */
  recurring: boolean;
  sound: boolean;
  browser: boolean;
}

export interface AlertHistoryEntry {
  id: string;
  alertId: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  triggerPrice: number;
  triggerTime: number; // epoch seconds
}

export interface AlertSettings {
  toast: boolean;
  sound: boolean;
  browser: boolean;
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
  above: 'Price above',
  below: 'Price below',
  crossUp: 'Crossing up',
  crossDown: 'Crossing down',
};

export const CONDITION_SYMBOL: Record<AlertCondition, string> = {
  above: '≥',
  below: '≤',
  crossUp: '↗',
  crossDown: '↘',
};

const STORAGE_KEY = 'alerts';
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

interface AlertState {
  alerts: Alert[];
  triggeredAlerts: Alert[];
  history: AlertHistoryEntry[];
  settings: AlertSettings;
  /** Chart-overlay selection (TradingView-style; only one at a time). Ephemeral. */
  selectedAlertId: string | null;
  /** Alert currently open in the edit dialog (or null). Ephemeral. */
  editingAlertId: string | null;

  // CRUD
  createAlert: (input: CreateAlertInput) => Alert;
  updateAlert: (id: string, patch: Partial<Omit<Alert, 'id'>>) => void;
  deleteAlert: (id: string) => void;
  duplicateAlert: (id: string) => Alert | undefined;

  // chart-overlay selection / editing (not persisted)
  selectAlert: (id: string | null) => void;
  editAlert: (id: string | null) => void;

  // lifecycle
  triggerAlert: (id: string, triggerPrice: number) => Alert | undefined;
  resetAlert: (id: string) => void;

  // bulk / settings
  clearTriggered: () => void;
  clearHistory: () => void;
  setSettings: (patch: Partial<AlertSettings>) => void;

  hydrate: () => void;

  // ---- backward-compat (chart context menu) ----
  /** Legacy one-click create. `condition` defaults to a plain price cross. */
  add: (symbol: string, price: number, condition?: AlertCondition) => Alert;
  remove: (id: string) => void;
  clear: () => void;
}

const DEFAULT_SETTINGS: AlertSettings = { toast: true, sound: true, browser: false };

function persist(get: () => AlertState) {
  const { alerts, triggeredAlerts, history, settings } = get();
  const shape: PersistShape = { alerts, triggeredAlerts, history, settings };
  localStore.set(STORAGE_KEY, shape);
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],
  triggeredAlerts: [],
  history: [],
  settings: DEFAULT_SETTINGS,
  selectedAlertId: null,
  editingAlertId: null,

  createAlert: (input) => {
    const { settings } = get();
    const alert: Alert = {
      id: uid('alert'),
      symbol: input.symbol,
      condition: input.condition,
      price: input.price,
      status: 'active',
      enabled: true,
      locked: false,
      createdAt: Date.now() / 1000,
      note: input.note,
      recurring: input.recurring ?? false,
      sound: settings.sound,
      browser: settings.browser,
    };
    set((s) => ({ alerts: [alert, ...s.alerts] }));
    persist(get);
    return alert;
  },

  updateAlert: (id, patch) => {
    set((s) => ({
      alerts: s.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      triggeredAlerts: s.triggeredAlerts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
    persist(get);
  },

  deleteAlert: (id) => {
    set((s) => ({
      alerts: s.alerts.filter((a) => a.id !== id),
      triggeredAlerts: s.triggeredAlerts.filter((a) => a.id !== id),
      selectedAlertId: s.selectedAlertId === id ? null : s.selectedAlertId,
      editingAlertId: s.editingAlertId === id ? null : s.editingAlertId,
    }));
    persist(get);
  },

  duplicateAlert: (id) => {
    const src = get().alerts.find((a) => a.id === id) ?? get().triggeredAlerts.find((a) => a.id === id);
    if (!src) return undefined;
    const clone: Alert = {
      ...src,
      id: uid('alert'),
      status: 'active',
      createdAt: Date.now() / 1000,
      triggeredAt: undefined,
      triggerPrice: undefined,
    };
    set((s) => ({ alerts: [clone, ...s.alerts], selectedAlertId: clone.id }));
    persist(get);
    return clone;
  },

  selectAlert: (id) => set({ selectedAlertId: id }),
  editAlert: (id) => set({ editingAlertId: id }),

  triggerAlert: (id, triggerPrice) => {
    const alert = get().alerts.find((a) => a.id === id);
    if (!alert) return undefined;
    const now = Date.now() / 1000;
    const fired: Alert = { ...alert, status: 'triggered', triggeredAt: now, triggerPrice };
    const entry: AlertHistoryEntry = {
      id: uid('alh'),
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      targetPrice: alert.price,
      triggerPrice,
      triggerTime: now,
    };

    set((s) => {
      const history = [entry, ...s.history].slice(0, MAX_HISTORY);
      if (alert.recurring) {
        // Stay armed; just stamp the last trigger time (engine re-arm gate).
        return {
          history,
          alerts: s.alerts.map((a) => (a.id === id ? { ...a, triggeredAt: now, triggerPrice } : a)),
        };
      }
      // One-time: move active → triggered.
      return {
        history,
        alerts: s.alerts.filter((a) => a.id !== id),
        triggeredAlerts: [fired, ...s.triggeredAlerts].slice(0, MAX_TRIGGERED),
      };
    });
    persist(get);
    return fired;
  },

  resetAlert: (id) => {
    set((s) => {
      const fired = s.triggeredAlerts.find((a) => a.id === id);
      if (!fired) return s;
      const rearmed: Alert = { ...fired, status: 'active', triggeredAt: undefined, triggerPrice: undefined };
      return {
        triggeredAlerts: s.triggeredAlerts.filter((a) => a.id !== id),
        alerts: [rearmed, ...s.alerts],
      };
    });
    persist(get);
  },

  clearTriggered: () => {
    set({ triggeredAlerts: [] });
    persist(get);
  },
  clearHistory: () => {
    set({ history: [] });
    persist(get);
  },
  setSettings: (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    persist(get);
  },

  hydrate: () => {
    const saved = localStore.get<PersistShape | null>(STORAGE_KEY, null);
    if (!saved) return;
    // Migrate alerts persisted before `enabled`/`locked` existed.
    const migrate = (a: Alert): Alert => ({ ...a, enabled: a.enabled ?? true, locked: a.locked ?? false });
    set({
      alerts: (saved.alerts ?? []).map(migrate),
      triggeredAlerts: (saved.triggeredAlerts ?? []).map(migrate),
      history: saved.history ?? [],
      settings: { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) },
    });
  },

  // ---- backward-compat ----
  add: (symbol, price, condition = 'crossUp') =>
    get().createAlert({ symbol, condition, price }),
  remove: (id) => get().deleteAlert(id),
  clear: () => {
    set({ alerts: [] });
    persist(get);
  },
}));

/** Selector: all alerts that should render a live price line (active only). */
export const selectActiveAlerts = (s: AlertState) => s.alerts;
