"use client";
import { atom, getDefaultStore, type Getter } from "jotai";
import { localStore } from "@/services/storage";
import { DEFAULT_PANELS, DEFAULT_UI_SETTINGS } from "./workspaceDefaults";

export type Theme = "dark" | "light";

/** Which bottom-panel tab is active. */
export type BottomTab =
  | "replay"
  | "trade"
  | "journal"
  | "analytics"
  | "pine"
  | "logs";

interface PanelSizes {
  /** Right watchlist width (px). */
  right: number;
  /** Bottom panel height (px). */
  bottom: number;
  /** Left toolbar width (px) — fixed, but kept for completeness. */
  left: number;
}

/** Shape exposed by the compatibility hook / getUIState(). */
export interface UIState {
  theme: Theme;
  panels: PanelSizes;
  bottomTab: BottomTab;
  rightOpen: boolean;
  bottomOpen: boolean;
  fullscreen: boolean;
  alertCenterOpen: boolean;
  gridVisible: boolean;
  logs: {
    id: number;
    time: number;
    level: "info" | "warn" | "error";
    msg: string;
  }[];
}

// SSR-safe deterministic defaults live in workspaceDefaults.ts so tests and
// backend sync docs can assert the same first-load behavior.
// ---------------------------------------------------------------------------
// Individual state atoms
// ---------------------------------------------------------------------------
export const themeAtom = atom<Theme>("dark");
export const panelsAtom = atom<PanelSizes>({ ...DEFAULT_PANELS });
export const bottomTabAtom = atom<BottomTab>("replay");
export const rightOpenAtom = atom<boolean>(true);
export const bottomOpenAtom = atom<boolean>(DEFAULT_UI_SETTINGS.bottomOpen);
export const fullscreenAtom = atom<boolean>(false);
export const alertCenterOpenAtom = atom<boolean>(false);
export const gridVisibleAtom = atom<boolean>(true);
export const logsAtom = atom<
  { id: number; time: number; level: "info" | "warn" | "error"; msg: string }[]
>([]);

// Internal counter for log ids.
const logIdAtom = atom(0);

// ---------------------------------------------------------------------------
// Derived read-only atom (all state — used by compatibility hook)
// ---------------------------------------------------------------------------
export const uiStateAtom = atom<UIState>((get) => ({
  theme: get(themeAtom),
  panels: get(panelsAtom),
  bottomTab: get(bottomTabAtom),
  rightOpen: get(rightOpenAtom),
  bottomOpen: get(bottomOpenAtom),
  fullscreen: get(fullscreenAtom),
  alertCenterOpen: get(alertCenterOpenAtom),
  gridVisible: get(gridVisibleAtom),
  logs: get(logsAtom),
}));

// ---------------------------------------------------------------------------
// Write atoms (actions)
// ---------------------------------------------------------------------------

export const setThemeAtom = atom(null, (get, set, theme: Theme) => {
  set(themeAtom, theme);
  persistUI(get, { theme });
  if (typeof document !== "undefined") {
    document.documentElement.className = `theme-${theme}`;
  }
});

export const toggleGridAtom = atom(null, (get, set) => {
  set(gridVisibleAtom, (prev) => !prev);
});

export const toggleThemeAtom = atom(null, (get, set) => {
  const theme = get(themeAtom) === "dark" ? "light" : "dark";
  set(setThemeAtom, theme);
});

export const setPanelAtom = atom(
  null,
  (get, set, key: keyof PanelSizes, value: number) => {
    const panels = { ...get(panelsAtom), [key]: value };
    set(panelsAtom, panels);
    persistUI(get, { panels });
  },
);

export const setBottomTabAtom = atom(null, (get, set, tab: BottomTab) => {
  set(bottomTabAtom, tab);
  set(bottomOpenAtom, true);
  if (tab === "pine") {
    const panels = {
      ...get(panelsAtom),
      bottom: Math.max(get(panelsAtom).bottom, 320),
    };
    set(panelsAtom, panels);
    persistUI(get, { panels, bottomOpen: true });
  } else {
    persistUI(get, { bottomOpen: true });
  }
});

export const toggleRightAtom = atom(null, (get, set) => {
  set(rightOpenAtom, (prev) => !prev);
});

export const toggleBottomAtom = atom(null, (get, set) => {
  const open = !get(bottomOpenAtom);
  set(bottomOpenAtom, open);
  persistUI(get, { bottomOpen: open });
});

export const setBottomOpenAtom = atom(null, (get, set, open: boolean) => {
  set(bottomOpenAtom, open);
  persistUI(get, { bottomOpen: open });
});

export const setFullscreenAtom = atom(null, (_get, set, v: boolean) => {
  set(fullscreenAtom, v);
});

export const toggleAlertCenterAtom = atom(null, (get, set) => {
  set(alertCenterOpenAtom, (prev) => !prev);
});

export const setAlertCenterAtom = atom(null, (_get, set, v: boolean) => {
  set(alertCenterOpenAtom, v);
});

export const logAtom = atom(
  null,
  (get, set, level: "info" | "warn" | "error", msg: string) => {
    const id = get(logIdAtom) + 1;
    set(logIdAtom, id);
    set(logsAtom, (prev) =>
      [{ id, time: Date.now() / 1000, level, msg }, ...prev].slice(0, 200),
    );
  },
);

export const hydrateAtom = atom(null, (get, set) => {
  const persisted = localStore.get("ui", {
    theme: get(themeAtom),
    panels: get(panelsAtom),
    bottomOpen: DEFAULT_UI_SETTINGS.bottomOpen,
  });
  set(themeAtom, persisted.theme);
  set(panelsAtom, sanitizePanels(persisted.panels, get(panelsAtom)));
  set(
    bottomOpenAtom,
    normalizeBoolean(persisted.bottomOpen, DEFAULT_UI_SETTINGS.bottomOpen),
  );
  if (typeof document !== "undefined") {
    document.documentElement.className = `theme-${persisted.theme}`;
  }
});

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizePanels(value: unknown, fallback: PanelSizes): PanelSizes {
  if (!isObject(value)) return fallback;
  return {
    right:
      typeof value.right === "number" && Number.isFinite(value.right)
        ? value.right
        : fallback.right,
    bottom:
      typeof value.bottom === "number" && Number.isFinite(value.bottom)
        ? value.bottom
        : fallback.bottom,
    left:
      typeof value.left === "number" && Number.isFinite(value.left)
        ? value.left
        : fallback.left,
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function persistUI(
  get: Getter,
  overrides: Partial<Pick<UIState, "theme" | "panels" | "bottomOpen">> = {},
): void {
  localStore.set("ui", {
    theme: overrides.theme ?? get(themeAtom),
    panels: overrides.panels ?? get(panelsAtom),
    bottomOpen: overrides.bottomOpen ?? get(bottomOpenAtom),
  });
}

export const applyRemoteUISettingsAtom = atom(
  null,
  (get, set, payload: unknown) => {
    if (!isObject(payload)) return;

    const theme =
      payload.theme === "dark" || payload.theme === "light"
        ? payload.theme
        : get(themeAtom);
    const panels = sanitizePanels(payload.panels, get(panelsAtom));
    const bottomOpen = normalizeBoolean(
      payload.bottomOpen,
      DEFAULT_UI_SETTINGS.bottomOpen,
    );

    set(themeAtom, theme);
    set(panelsAtom, panels);
    set(bottomOpenAtom, bottomOpen);
    localStore.set("ui", { theme, panels, bottomOpen });
    if (typeof document !== "undefined") {
      document.documentElement.className = `theme-${theme}`;
    }
  },
);

// ---------------------------------------------------------------------------
// Non-React accessor — mirrors `useUIStore.getState()` for non-React code.
// ---------------------------------------------------------------------------
export const resetUIToDefaultsAtom = atom(null, (_get, set) => {
  const panels = { ...DEFAULT_PANELS };
  set(themeAtom, "dark");
  set(panelsAtom, panels);
  set(bottomTabAtom, "replay");
  set(rightOpenAtom, true);
  set(bottomOpenAtom, DEFAULT_UI_SETTINGS.bottomOpen);
  set(fullscreenAtom, false);
  set(alertCenterOpenAtom, false);
  set(gridVisibleAtom, true);
  localStore.remove("ui");
  if (typeof document !== "undefined") {
    document.documentElement.className = "theme-dark";
  }
});

export function getUIState() {
  const store = getDefaultStore();
  return {
    theme: store.get(themeAtom),
    panels: store.get(panelsAtom),
    bottomTab: store.get(bottomTabAtom),
    rightOpen: store.get(rightOpenAtom),
    bottomOpen: store.get(bottomOpenAtom),
    fullscreen: store.get(fullscreenAtom),
    alertCenterOpen: store.get(alertCenterOpenAtom),
    gridVisible: store.get(gridVisibleAtom),
    logs: store.get(logsAtom),
  };
}

// ---------------------------------------------------------------------------
// Compatibility hook — mirrors `useUIStore(selector?)` from Zustand.
// Prefer `useAtomValue(themeAtom)` etc. in new code for optimal rendering.
// ---------------------------------------------------------------------------
import { useAtomValue } from "jotai";
import { useMemo } from "react";

export function useUIStore(): UIState;
export function useUIStore<T>(selector: (state: UIState) => T): T;
export function useUIStore<T>(selector?: (state: UIState) => T): UIState | T {
  const state = useAtomValue(uiStateAtom);
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMemo(() => selector(state), [state, selector]);
  }
  return state;
}
