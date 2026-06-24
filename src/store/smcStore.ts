'use client';
import { create } from 'zustand';
import { localStore } from '@/services/storage';
import type { SmcSnapshot } from '@/types';

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
  trend: 'ranging',
};

interface SmcState {
  snapshot: SmcSnapshot;
  settings: SmcSettings;
  setSnapshot: (s: SmcSnapshot) => void;
  toggle: (key: keyof SmcSettings) => void;
  /** Load persisted SMC overlay settings from localStorage. Client-only. */
  hydrate: () => void;
}

const DEFAULT_SETTINGS: SmcSettings = {
  structure: true,
  fvg: true,
  orderBlocks: true,
  liquidity: true,
  displacement: false,
  sessions: true,
  killzones: true,
  swings: true,
};

export const useSmcStore = create<SmcState>((set, get) => ({
  snapshot: EMPTY,
  // Deterministic defaults for SSR; persisted settings loaded via hydrate().
  settings: DEFAULT_SETTINGS,
  hydrate: () => set({ settings: localStore.get('smc-settings', DEFAULT_SETTINGS) }),
  setSnapshot: (snapshot) => set({ snapshot }),
  toggle: (key) => {
    const enabled = !get().settings[key];
    const settings = { ...get().settings, [key]: enabled };
    set({ settings });
    localStore.set('smc-settings', settings);
    // Debug trace: confirms the menu → state hop fired for this feature.
    console.debug('SMC toggle:', { feature: key, enabled });
  },
}));
