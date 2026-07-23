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
import { isApiError } from "@/services/api/errors";
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
import {
  hasAlertArmingChange,
  isTriggerPriceValid,
} from "@/services/alertConditions";
import type { DrawingAlertSnapshot } from "@/components/chart/drawing/alerts/drawingAlertCapabilities";
import type {
  TechnicalAlertEvidence,
  TechnicalAlertTarget,
} from "@/types/technicalAlerts";
import {
  sanitizeTechnicalAlertEvidence,
  sanitizeTechnicalAlertTarget,
} from "@/services/dynamicAlertTargets";
import type { BrowserAlertTriggerAttempt } from "@/services/notifications/browserAlertTriggerQueue";
import { normalizeAlertSymbol } from "@/services/alertSymbols";
import {
  isAlertCondition,
  sanitizeAlertNote,
  sanitizeAlertSource,
} from "@/services/alertValidation";

/** Incremented on every mutation so external subscribers (e.g. AlertOverlay canvas) can react. */
export const alertTickAtom = atom<number>(0);

export type AlertCondition = "above" | "below" | "crossUp" | "crossDown";
export type AlertStatus = "active" | "triggered" | "expired";

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
  /** Stable evaluator baseline; changes only when the alert is re-armed. */
  armingRevision: number;
  triggeredAt?: number;
  expiredAt?: number;
  triggerPrice?: number;
  evaluatedTargetPrice?: number;
  triggerEvidence?: TechnicalAlertEvidence;
  note?: string;
  recurring: boolean;
  sound: boolean;
  browser: boolean;
  push: boolean;
  telegram: boolean;
  discord: boolean;
  /** Immutable provenance for fixed-price or versioned geometry evaluation. */
  source?: DrawingAlertSnapshot;
  /** Immutable versioned geometry. `price` remains its creation-time preview. */
  technicalTarget?: TechnicalAlertTarget;
}

export interface AlertHistoryEntry {
  id: string;
  alertId: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  triggerPrice: number;
  triggerTime: number;
  evidence?: TechnicalAlertEvidence;
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
  source?: DrawingAlertSnapshot;
  technicalTarget?: TechnicalAlertTarget;
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
export const MAX_ALERT_NOTE_LENGTH = 500;
/** Recurring alerts re-arm after this gap so one cross doesn't fire every tick. */
export const RECURRING_REARM_MS = 60_000;

function epochMillis(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value >= 100_000_000_000 ? value : value * 1000;
}

interface PersistShape {
  alerts: Alert[];
  triggeredAlerts: Alert[];
  expiredAlerts: Alert[];
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
    expiredAlerts: store.get(expiredAlertsAtom),
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

type AlertSyncOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

function queueAlertSync<T>(
  get: Getter,
  alertID: string,
  action: string,
  request: () => Promise<T>,
): Promise<AlertSyncOutcome<T>> {
  if (!syncEnabled(get)) {
    return Promise.resolve({ ok: true, value: undefined as T });
  }
  const previous = alertSyncQueues.get(alertID) ?? Promise.resolve();
  const outcome: Promise<AlertSyncOutcome<T>> = previous
    .catch(() => undefined)
    .then(request)
    .then((value) => ({ ok: true as const, value }))
    .catch((error) => {
      reportSyncError(action, error);
      return { ok: false as const, error };
    });
  let tracked: Promise<void>;
  tracked = outcome
    .then(() => undefined)
    .finally(() => {
      if (alertSyncQueues.get(alertID) === tracked) {
        alertSyncQueues.delete(alertID);
      }
    });
  alertSyncQueues.set(alertID, tracked);
  return outcome;
}

function isRetryableTriggerError(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
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
export const expiredAlertsAtom = atom<Alert[]>([]);
export const historyAtom = atom<AlertHistoryEntry[]>([]);
export const settingsAtom = atom<AlertSettings>(DEFAULT_SETTINGS);
export const selectedAlertIdAtom = atom<string | null>(null);
export const editingAlertIdAtom = atom<string | null>(null);

// ── Write atoms: CRUD ────────────────────────────────────────────────────────

export const createAlertAtom = atom(
  null,
  (get, set, input: CreateAlertInput): Alert => {
    const settings = get(settingsAtom);
    const symbol = normalizeAlertSymbol(input.symbol);
    if (!symbol) throw new Error("Cannot create an alert without a symbol.");
    if (!isAlertCondition(input.condition)) {
      throw new Error("Cannot create an alert with an unsupported condition.");
    }
    if (!Number.isFinite(input.price) || input.price <= 0) {
      throw new Error("Cannot create an alert with an invalid target price.");
    }
    const rawNote = input.note?.trim() || "";
    if ([...rawNote].length > MAX_ALERT_NOTE_LENGTH) {
      throw new Error(
        `Alert message cannot exceed ${MAX_ALERT_NOTE_LENGTH} characters.`,
      );
    }
    const note = sanitizeAlertNote(rawNote);
    const source = sanitizeAlertSource(input.source);
    if (input.source !== undefined && !source) {
      throw new Error("Cannot create an alert with invalid drawing provenance.");
    }
    const technicalTarget = sanitizeTechnicalAlertTarget(input.technicalTarget);
    if (input.technicalTarget !== undefined && !technicalTarget) {
      throw new Error("Cannot create an alert with an invalid technical target.");
    }
    const alert: Alert = {
      id: uid("alert"),
      symbol,
      condition: input.condition,
      price: input.price,
      status: "active",
      enabled: true,
      locked: false,
      createdAt: Date.now() / 1000,
      updatedAt: Date.now() / 1000,
      armingRevision: 1,
      note,
      recurring: input.recurring ?? false,
      sound: settings.sound,
      browser: settings.browser,
      push: settings.push,
      telegram: settings.telegram,
      discord: settings.discord,
      source,
      technicalTarget,
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
    const existing =
      get(alertsAtom).find((alert) => alert.id === id) ??
      get(triggeredAlertsAtom).find((alert) => alert.id === id) ??
      get(expiredAlertsAtom).find((alert) => alert.id === id);
    if (!existing) return;
    let safePatch = { ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, "symbol")) {
      const symbol = normalizeAlertSymbol(patch.symbol ?? "");
      if (!symbol) throw new Error("Alert symbol cannot be empty.");
      safePatch.symbol = symbol;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "condition")) {
      if (!isAlertCondition(patch.condition)) {
        throw new Error("Alert condition is unsupported.");
      }
      safePatch.condition = patch.condition;
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, "price") &&
      (typeof patch.price !== "number" ||
        !Number.isFinite(patch.price) ||
        patch.price <= 0)
    ) {
      throw new Error("Alert target price must be greater than zero.");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "note")) {
      const rawNote = patch.note?.trim() || "";
      if ([...rawNote].length > MAX_ALERT_NOTE_LENGTH) {
        throw new Error(
          `Alert message cannot exceed ${MAX_ALERT_NOTE_LENGTH} characters.`,
        );
      }
      safePatch.note = sanitizeAlertNote(rawNote);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "source")) {
      // Provenance is immutable once an alert exists. Sending it in a patch
      // would be ignored by the backend and leave the two stores divergent.
      throw new Error("Alert drawing provenance cannot be edited.");
    }
    if (Object.prototype.hasOwnProperty.call(patch, "technicalTarget")) {
      const technicalTarget = sanitizeTechnicalAlertTarget(patch.technicalTarget);
      if (!technicalTarget) {
        throw new Error("Cannot update an alert with an invalid technical target.");
      }
      safePatch = { ...safePatch, technicalTarget };
    }
    const rearm = hasAlertArmingChange(existing, safePatch);
    const applyPatch = (alert: Alert): Alert => ({
      ...alert,
      ...safePatch,
      updatedAt: Date.now() / 1000,
      armingRevision: rearm
        ? (alert.armingRevision ?? alert.updatedAt) + 1
        : alert.armingRevision,
      ...(rearm
        ? {
            status: "active",
            triggeredAt: undefined,
            expiredAt: undefined,
            triggerPrice: undefined,
            evaluatedTargetPrice: undefined,
            triggerEvidence: undefined,
          }
        : {}),
    });
    const updated = applyPatch(existing);
    if (rearm) {
      set(alertsAtom, [updated, ...get(alertsAtom).filter((a) => a.id !== id)]);
      set(triggeredAlertsAtom, get(triggeredAlertsAtom).filter((a) => a.id !== id));
      set(expiredAlertsAtom, get(expiredAlertsAtom).filter((a) => a.id !== id));
    } else {
      set(alertsAtom, get(alertsAtom).map((a) => a.id === id ? updated : a));
      set(triggeredAlertsAtom, get(triggeredAlertsAtom).map((a) => a.id === id ? updated : a));
      set(expiredAlertsAtom, get(expiredAlertsAtom).map((a) => a.id === id ? updated : a));
    }
    persist();
    const current =
      get(alertsAtom).find((alert) => alert.id === id) ??
      get(triggeredAlertsAtom).find((alert) => alert.id === id) ??
      get(expiredAlertsAtom).find((alert) => alert.id === id);
    if (current) {
      queueAlertSync(get, id, "update", () =>
        patchRemoteAlert(id, {
          ...localAlertToPatch(current),
          ...(rearm ? { status: "active" } : {}),
        }),
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
  set(expiredAlertsAtom, get(expiredAlertsAtom).filter((a) => a.id !== id));
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
      get(triggeredAlertsAtom).find((a) => a.id === id) ??
      get(expiredAlertsAtom).find((a) => a.id === id);
    if (!src) return undefined;
    const clone: Alert = {
      ...src,
      id: uid("alert"),
      status: "active",
      createdAt: Date.now() / 1000,
      updatedAt: Date.now() / 1000,
      armingRevision: 1,
      triggeredAt: undefined,
      expiredAt: undefined,
      triggerPrice: undefined,
      evaluatedTargetPrice: undefined,
      triggerEvidence: undefined,
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
  async (
    get,
    set,
    id: string,
    triggerPrice: number,
    triggeredAtMs?: number,
    targetPrice?: number,
    evidence?: TechnicalAlertEvidence,
  ): Promise<BrowserAlertTriggerAttempt<Alert>> => {
    const alert = get(alertsAtom).find((a) => a.id === id);
    if (!alert || !alert.enabled || alert.status !== "active") {
      return { status: "discarded" };
    }
    const safeEvidence =
      evidence === undefined
        ? undefined
        : sanitizeTechnicalAlertEvidence(evidence);
    if (evidence !== undefined && !safeEvidence) {
      // Do not turn a partially migrated/invalid local cache into a canonical
      // 400. Wait for the next real market observation instead.
      return { status: "discarded" };
    }
    const evaluatedTarget = targetPrice ?? alert.price;
    const validDynamicChannel =
      alert.technicalTarget?.kind === "dynamic-channel" &&
      Number.isFinite(evaluatedTarget) &&
      evaluatedTarget > 0 &&
      Number.isFinite(triggerPrice) &&
      triggerPrice > 0;
    if (!validDynamicChannel && !isTriggerPriceValid(alert.condition, evaluatedTarget, triggerPrice)) {
      return { status: "discarded" };
    }
    const persisted = await queueAlertSync(get, id, "trigger", () =>
      triggerRemoteAlert(
        id,
        triggerPrice,
        evaluatedTarget,
        safeEvidence,
        alert.armingRevision,
      ),
    );
    if (!persisted.ok) {
      return {
        status: isRetryableTriggerError(persisted.error)
          ? "retryable"
          : "discarded",
      };
    }

    const canonicalResponse = persisted.value;
    const canonicalEvent = canonicalResponse?.event;
    const canonicalTriggerPrice =
      canonicalEvent?.triggerPrice ?? triggerPrice;
    const canonicalTargetPrice =
      canonicalEvent?.targetPrice ?? evaluatedTarget;
    const canonicalEvidence =
      sanitizeTechnicalAlertEvidence(canonicalEvent?.evidence) ?? safeEvidence;
    const parsedCanonicalTime = canonicalEvent?.triggeredAt
      ? Date.parse(canonicalEvent.triggeredAt) / 1000
      : Number.NaN;
    const fallbackTriggeredAtMs =
      epochMillis(triggeredAtMs) ??
      epochMillis(safeEvidence?.current.timestamp) ??
      Date.now();
    const canonicalTime = Number.isFinite(parsedCanonicalTime)
      ? parsedCanonicalTime
      : fallbackTriggeredAtMs / 1000;

    // The alert can be edited or deleted while the canonical request is in
    // flight. Apply the local lifecycle only if the same arming revision is
    // still active; the queued mutation order will reconcile later edits.
    const currentAlert = get(alertsAtom).find((item) => item.id === id);
    const fired: Alert = {
      ...alert,
      status: "triggered",
      triggeredAt: canonicalTime,
      triggerPrice: canonicalTriggerPrice,
      evaluatedTargetPrice: canonicalTargetPrice,
      triggerEvidence: canonicalEvidence,
    };
    if (
      !currentAlert ||
      !currentAlert.enabled ||
      currentAlert.status !== "active" ||
      currentAlert.armingRevision !== alert.armingRevision
    ) {
      if (canonicalResponse?.alreadyTriggered) {
        return { status: "discarded" };
      }
      // The canonical event committed before a queued local edit/delete. The
      // newer local mutation must win, but this immutable fired snapshot still
      // owns one best-effort notification attempt for the accepted crossing.
      return { status: "committed", value: fired };
    }

    if (canonicalResponse?.alreadyTriggered) {
      // Another evaluator already committed this event (usually the closed
      // browser worker). Converge local state without sending a second browser
      // notification and without surfacing a false "400" sync error.
      const canonicalHistory = canonicalEvent
        ? backendAlertEventToLocal(canonicalEvent)
        : undefined;
      if (
        canonicalHistory &&
        !get(historyAtom).some((entry) => entry.id === canonicalHistory.id)
      ) {
        set(historyAtom, [canonicalHistory, ...get(historyAtom)].slice(0, MAX_HISTORY));
      }
      const currentFired: Alert = {
        ...currentAlert,
        status: currentAlert.recurring ? "active" : "triggered",
        triggeredAt: canonicalTime,
        triggerPrice: canonicalTriggerPrice,
        evaluatedTargetPrice: canonicalTargetPrice,
        triggerEvidence: canonicalEvidence,
      };
      if (currentAlert.recurring) {
        set(
          alertsAtom,
          get(alertsAtom).map((item) => (item.id === id ? currentFired : item)),
        );
      } else {
        set(alertsAtom, get(alertsAtom).filter((item) => item.id !== id));
        set(
          triggeredAlertsAtom,
          [currentFired, ...get(triggeredAlertsAtom).filter((item) => item.id !== id)]
            .slice(0, MAX_TRIGGERED),
        );
      }
      persist();
      return { status: "discarded" };
    }

    const currentFired: Alert = {
      ...currentAlert,
      status: "triggered",
      triggeredAt: canonicalTime,
      triggerPrice: canonicalTriggerPrice,
      evaluatedTargetPrice: canonicalTargetPrice,
      triggerEvidence: canonicalEvidence,
    };
    const entry: AlertHistoryEntry = {
      id: canonicalEvent?.id ?? uid("alh"),
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      targetPrice: canonicalTargetPrice,
      triggerPrice: canonicalTriggerPrice,
      triggerTime: canonicalTime,
      evidence: canonicalEvidence,
    };

    if (!get(historyAtom).some((item) => item.id === entry.id)) {
      set(historyAtom, [entry, ...get(historyAtom)].slice(0, MAX_HISTORY));
    }

    if (currentAlert.recurring) {
      // Stay armed; just stamp the last trigger time (engine re-arm gate).
      set(
        alertsAtom,
        get(alertsAtom).map((a) =>
          a.id === id
            ? {
                ...a,
                triggeredAt: canonicalTime,
                triggerPrice: canonicalTriggerPrice,
                evaluatedTargetPrice: canonicalTargetPrice,
                triggerEvidence: canonicalEvidence,
              }
            : a,
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
        [currentFired, ...get(triggeredAlertsAtom)].slice(0, MAX_TRIGGERED),
      );
    }
    persist();
    return {
      status: "committed",
      value: fired,
    };
  },
);

export const expireAlertAtom = atom(
  null,
  (get, set, id: string, expiredAtMs?: number): Alert | undefined => {
    const alert = get(alertsAtom).find((item) => item.id === id);
    if (!alert || alert.status !== "active" || !alert.technicalTarget) return undefined;
    const expired: Alert = {
      ...alert,
      status: "expired",
      expiredAt: (expiredAtMs ?? Date.now()) / 1000,
      updatedAt: Date.now() / 1000,
    };
    set(alertsAtom, get(alertsAtom).filter((item) => item.id !== id));
    set(expiredAlertsAtom, [expired, ...get(expiredAlertsAtom).filter((item) => item.id !== id)]);
    persist();
    queueAlertSync(get, id, "expire", () =>
      patchRemoteAlert(id, {
        status: "expired",
        armingRevision: alert.armingRevision,
      }),
    );
    return expired;
  },
);

export const resetAlertAtom = atom(null, (get, set, id: string) => {
  const fired =
    get(triggeredAlertsAtom).find((a) => a.id === id) ??
    get(expiredAlertsAtom).find((a) => a.id === id);
  if (!fired) return;
  const rearmed: Alert = {
    ...fired,
    status: "active",
    updatedAt: Date.now() / 1000,
    armingRevision: (fired.armingRevision ?? fired.updatedAt) + 1,
    triggeredAt: undefined,
    expiredAt: undefined,
    triggerPrice: undefined,
    evaluatedTargetPrice: undefined,
    triggerEvidence: undefined,
  };
  set(
    triggeredAlertsAtom,
    get(triggeredAlertsAtom).filter((a) => a.id !== id),
  );
  set(expiredAlertsAtom, get(expiredAlertsAtom).filter((a) => a.id !== id));
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

export const clearExpiredAtom = atom(null, (get, set) => {
  const ids = get(expiredAlertsAtom).map((alert) => alert.id);
  set(expiredAlertsAtom, []);
  persist();
  for (const id of ids) {
    queueAlertSync(get, id, "clear expired", () => deleteRemoteAlert(id));
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
  const migrate = (a: Alert): Alert | undefined => {
    const symbol = normalizeAlertSymbol(a.symbol ?? "");
    if (
      !symbol ||
      !isAlertCondition(a.condition) ||
      !Number.isFinite(a.price) ||
      a.price <= 0
    ) {
      return undefined;
    }
    const technicalTarget = sanitizeTechnicalAlertTarget(a.technicalTarget);
    if (a.technicalTarget !== undefined && !technicalTarget) return undefined;
    const source = sanitizeAlertSource(a.source);
    const triggerEvidence = sanitizeTechnicalAlertEvidence(a.triggerEvidence);
    const note = sanitizeAlertNote(a.note);
    const createdAt =
      typeof a.createdAt === "number" && Number.isFinite(a.createdAt) && a.createdAt > 0
        ? a.createdAt
        : Date.now() / 1000;
    const updatedAt =
      typeof a.updatedAt === "number" && Number.isFinite(a.updatedAt) && a.updatedAt > 0
        ? a.updatedAt
        : createdAt;
    return {
      ...a,
      symbol,
      condition: a.condition,
      enabled: a.enabled ?? true,
      locked: a.locked ?? false,
      createdAt,
      updatedAt,
      armingRevision: Math.max(
        1,
        Math.trunc(
          typeof a.armingRevision === "number" && Number.isFinite(a.armingRevision)
            ? a.armingRevision
            : updatedAt,
        ),
      ),
      sound: a.sound ?? true,
      browser: a.browser ?? false,
      push: a.push ?? false,
      telegram: a.telegram ?? false,
      discord: a.discord ?? false,
      note,
      source,
      triggerEvidence,
      technicalTarget,
    };
  };
  const migrateAll = (alerts: Alert[]): Alert[] => alerts
    .map(migrate)
    .filter((alert): alert is Alert => Boolean(alert));
  set(alertsAtom, migrateAll(saved.alerts ?? []));
  set(triggeredAlertsAtom, migrateAll(saved.triggeredAlerts ?? []));
  set(expiredAlertsAtom, migrateAll(saved.expiredAlerts ?? []));
  set(
    historyAtom,
    (saved.history ?? [])
      .map((entry) => ({
        ...entry,
        symbol: normalizeAlertSymbol(entry.symbol ?? ""),
      }))
      .filter(
        (entry) =>
          entry.symbol &&
          isAlertCondition(entry.condition) &&
          Number.isFinite(entry.targetPrice) &&
          entry.targetPrice > 0 &&
          Number.isFinite(entry.triggerPrice) &&
          entry.triggerPrice > 0 &&
          Number.isFinite(entry.triggerTime) &&
          entry.triggerTime > 0,
      ),
  );
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
    const localExpired = get(expiredAlertsAtom);
    const localHistory = get(historyAtom);
    const remoteEmpty =
      snapshot.alerts.length === 0 &&
      snapshot.triggeredAlerts.length === 0 &&
      (snapshot.expiredAlerts?.length ?? 0) === 0 &&
      snapshot.history.length === 0;

    // First backend sign-in migration: preserve the existing browser workspace
    // and idempotently upload it instead of letting an empty server snapshot
    // erase alerts created before Phase 10 persistence existed.
    if (
      remoteEmpty &&
      (localAlerts.length > 0 ||
        localTriggered.length > 0 ||
        localExpired.length > 0 ||
        localHistory.length > 0)
    ) {
      // The backend initializes first-generation rows at revision 1. Normalize
      // pre-backend local timestamps/counters so both evaluators share the same
      // optimistic revision immediately after migration.
      const migratedActive = localAlerts.map((alert) => ({
        ...alert,
        armingRevision: 1,
      }));
      const migratedTriggered = localTriggered.map((alert) => ({
        ...alert,
        armingRevision: 1,
      }));
      const migratedExpired = localExpired.map((alert) => ({
        ...alert,
        armingRevision: 1,
      }));
      set(alertsAtom, migratedActive);
      set(triggeredAlertsAtom, migratedTriggered);
      set(expiredAlertsAtom, migratedExpired);
      for (const alert of migratedActive) {
        queueAlertSync(get, alert.id, "migrate active", () =>
          createRemoteAlert(localAlertToCreate(alert)),
        );
      }
      for (const alert of migratedTriggered) {
        const triggerPrice = alert.triggerPrice ?? alert.price;
        const evidence = sanitizeTechnicalAlertEvidence(alert.triggerEvidence);
        const needsCrossingEvidence =
          alert.condition === "crossUp" || alert.condition === "crossDown";
        if (
          !Number.isFinite(triggerPrice) ||
          triggerPrice <= 0 ||
          (needsCrossingEvidence && !evidence)
        ) {
          // A legacy cache can contain a visually triggered row without the
          // evidence required by the canonical endpoint. Do not recreate it as
          // an active remote alert and then emit a misleading 400 on startup.
          reportFrontendError(
            new Error(`Legacy triggered alert ${alert.id} has incomplete evidence.`),
            {
              title: "Alert migration skipped",
              logPrefix: "Invalid legacy triggered alert",
              toast: false,
            },
          );
          continue;
        }
        queueAlertSync(get, alert.id, "migrate triggered create", () =>
          createRemoteAlert(localAlertToCreate(alert)),
        );
        queueAlertSync(get, alert.id, "migrate triggered event", () =>
          triggerRemoteAlert(
            alert.id,
            triggerPrice,
            alert.evaluatedTargetPrice,
            evidence,
            alert.armingRevision,
          ),
        );
      }
      for (const alert of migratedExpired) {
        queueAlertSync(get, alert.id, "migrate expired create", () =>
          createRemoteAlert(localAlertToCreate(alert)),
        );
        queueAlertSync(get, alert.id, "migrate expired status", () =>
          patchRemoteAlert(alert.id, {
            status: "expired",
            armingRevision: alert.armingRevision,
          }),
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
    set(
      expiredAlertsAtom,
      (snapshot.expiredAlerts ?? []).map(backendAlertToLocal),
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
  set(expiredAlertsAtom, []);
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
  expiredAlerts: Alert[];
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
  triggerAlert: (
    id: string,
    triggerPrice: number,
    targetPrice?: number,
    evidence?: TechnicalAlertEvidence,
  ) => Promise<BrowserAlertTriggerAttempt<Alert>>;
  expireAlert: (id: string, expiredAtMs?: number) => Alert | undefined;
  resetAlert: (id: string) => void;
  clearTriggered: () => void;
  clearExpired: () => void;
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
  expiredAlerts: get(expiredAlertsAtom),
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
    triggerAlert: (id, triggerPrice, targetPrice, evidence) =>
      store.set(
        triggerAlertAtom,
        id,
        triggerPrice,
        undefined,
        targetPrice,
        evidence,
      ) as Promise<BrowserAlertTriggerAttempt<Alert>>,
    expireAlert: (id, expiredAtMs) =>
      store.set(expireAlertAtom, id, expiredAtMs) as Alert | undefined,
    resetAlert: (id) => store.set(resetAlertAtom, id),
    clearTriggered: () => store.set(clearTriggeredAtom),
    clearExpired: () => store.set(clearExpiredAtom),
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
