"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { localStore } from "@/services/storage";
import { DEFAULT_SMC_SETTINGS } from "./workspaceDefaults";
import type { SmcSnapshot } from "@/types";

/** Toggle visibility of each SMC overlay group. */
export interface SmcSettings {
  structure: boolean;
  fvg: boolean;
  orderBlocks: boolean;
  liquidity: boolean;
  displacement: boolean;
  sessions: boolean;
  killzones: boolean;
  swings: boolean;
}

const EMPTY: SmcSnapshot = {
  swings: [],
  structures: [],
  fvgs: [],
  orderBlocks: [],
  liquidity: [],
  displacements: [],
  sessions: [],
  killZones: [],
  trend: "ranging",
};

const SMC_STORAGE_KEY = "smc-settings-v2";
const LEGACY_SMC_STORAGE_KEY = "smc-settings";
const DEFAULT_SETTINGS: SmcSettings = { ...DEFAULT_SMC_SETTINGS };

// ── State atoms ────────────────────────────────────────────────────────────
export const smcSnapshotAtom = atom<SmcSnapshot>(EMPTY);
export const smcSettingsAtom = atom<SmcSettings>(DEFAULT_SETTINGS);

// ── Write atoms (actions) ──────────────────────────────────────────────────
export const setSmcSnapshotAtom = atom(
  null,
  (_get, set, snapshot: SmcSnapshot) => {
    set(smcSnapshotAtom, snapshot);
  },
);

export const toggleSmcAtom = atom(null, (get, set, key: keyof SmcSettings) => {
  const enabled = !get(smcSettingsAtom)[key];
  const settings = { ...get(smcSettingsAtom), [key]: enabled };
  set(smcSettingsAtom, settings);
  localStore.remove(LEGACY_SMC_STORAGE_KEY);
  localStore.set(SMC_STORAGE_KEY, settings);
  console.debug("SMC toggle:", { feature: key, enabled });
});

export const hydrateSmcAtom = atom(null, (_get, set) => {
  localStore.remove(LEGACY_SMC_STORAGE_KEY);
  set(
    smcSettingsAtom,
    normalizeSmcSettings(localStore.get<unknown>(SMC_STORAGE_KEY, DEFAULT_SETTINGS)),
  );
});

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSmcSettings(payload: unknown): SmcSettings {
  const settings: SmcSettings = { ...DEFAULT_SETTINGS };
  if (!isObject(payload)) return settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof SmcSettings>) {
    if (typeof payload[key] === "boolean") settings[key] = payload[key];
  }
  return settings;
}

export const applyRemoteSmcSettingsAtom = atom(
  null,
  (_get, set, payload: unknown) => {
    const settings = normalizeSmcSettings(payload);
    set(smcSettingsAtom, settings);
    localStore.remove(LEGACY_SMC_STORAGE_KEY);
    localStore.set(SMC_STORAGE_KEY, settings);
  },
);

// ── Combined state + actions (for compatibility hook) ──────────────────────
export const resetSmcToDefaultsAtom = atom(null, (_get, set) => {
  set(smcSnapshotAtom, EMPTY);
  set(smcSettingsAtom, DEFAULT_SETTINGS);
  localStore.remove(LEGACY_SMC_STORAGE_KEY);
  localStore.remove(SMC_STORAGE_KEY);
});

interface SmcState {
  snapshot: SmcSnapshot;
  settings: SmcSettings;
}

export interface SmcActions {
  setSnapshot: (s: SmcSnapshot) => void;
  toggle: (key: keyof SmcSettings) => void;
  hydrate: () => void;
}

type SmcStoreInterface = SmcState & SmcActions;

const smcStateAtom = atom<SmcState>((get) => ({
  snapshot: get(smcSnapshotAtom),
  settings: get(smcSettingsAtom),
}));

const smcCombinedAtom = atom<SmcStoreInterface>((get) => {
  const state = get(smcStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    setSnapshot: (s) => store.set(setSmcSnapshotAtom, s),
    toggle: (k) => store.set(toggleSmcAtom, k),
    hydrate: () => store.set(hydrateSmcAtom),
  };
});

// ── Compatibility hook ─────────────────────────────────────────────────────
export function useSmcStore(): SmcStoreInterface;
export function useSmcStore<T>(selector: (state: SmcStoreInterface) => T): T;
export function useSmcStore<T>(
  selector?: (state: SmcStoreInterface) => T,
): SmcStoreInterface | T {
  const combined = useAtomValue(smcCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

// Static getState() for non-React code.
export function getSmcState(): SmcStoreInterface {
  return getDefaultStore().get(smcCombinedAtom);
}
