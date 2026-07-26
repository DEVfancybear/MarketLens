"use client";
import { atom, getDefaultStore, type Getter, type Setter } from "jotai";
import { createSettingsMutationQueue } from "@/services/api/settingsMutationQueue";
import { localStore } from "@/services/storage";
import { backendSessionAtom } from "./authStore";
import { DEFAULT_PANELS, DEFAULT_UI_SETTINGS } from "./workspaceDefaults";

export type Theme = "dark" | "light";
export type DesktopWorkspace = "chart" | "trade";

export function applyThemeToDocument(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("theme-dark", theme === "dark");
  root.classList.toggle("theme-light", theme === "light");
  root.dataset.theme = theme;
}
export type RightPanelTab = "watchlist" | "objects";

/** Which bottom-panel tab is active. */
export type BottomTab =
  | "replay"
  | "journal"
  | "analytics"
  | "pine"
  | "logs";

export interface PanelSizes {
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
  desktopWorkspace: DesktopWorkspace;
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

type PersistedUISettings = Pick<
  UIState,
  | "theme"
  | "panels"
  | "bottomTab"
  | "rightOpen"
  | "bottomOpen"
  | "gridVisible"
> & { rightPanelTab: RightPanelTab };

// SSR-safe deterministic defaults live in workspaceDefaults.ts so tests and
// backend sync docs can assert the same first-load behavior.
// ---------------------------------------------------------------------------
// Individual state atoms
// ---------------------------------------------------------------------------
export const themeAtom = atom<Theme>("dark");
export const desktopWorkspaceAtom = atom<DesktopWorkspace>("chart");
export const panelsAtom = atom<PanelSizes>({ ...DEFAULT_PANELS });
export const bottomTabAtom = atom<BottomTab>("replay");
export const rightOpenAtom = atom<boolean>(true);
export const rightPanelTabAtom = atom<RightPanelTab>(
  DEFAULT_UI_SETTINGS.rightPanelTab,
);
export const bottomOpenAtom = atom<boolean>(DEFAULT_UI_SETTINGS.bottomOpen);
export const fullscreenAtom = atom<boolean>(false);
export const alertCenterOpenAtom = atom<boolean>(false);
export const gridVisibleAtom = atom<boolean>(true);
export const logsAtom = atom<
  { id: number; time: number; level: "info" | "warn" | "error"; msg: string }[]
>([]);

const uiSettingsSync = createSettingsMutationQueue("ui");

// Internal counter for log ids.
const logIdAtom = atom(0);

// ---------------------------------------------------------------------------
// Derived read-only atom (all state — used by compatibility hook)
// ---------------------------------------------------------------------------
export const uiStateAtom = atom<UIState>((get) => ({
  theme: get(themeAtom),
  desktopWorkspace: get(desktopWorkspaceAtom),
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
  applyThemeToDocument(theme);
  queueRemoteUISettings(get, set, { theme });
});

/**
 * Top-level desktop workspaces are URL-addressable. Trade intentionally lives
 * outside the resizable bottom panel, so chart state can remain mounted only
 * when the user is working on the chart and browser Back restores the prior
 * workspace predictably.
 */
export const setDesktopWorkspaceAtom = atom(
  null,
  (_get, set, workspace: DesktopWorkspace) => {
    set(desktopWorkspaceAtom, workspace);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (workspace === "trade") url.searchParams.set("workspace", "trade");
    else url.searchParams.delete("workspace");
    window.history.pushState(
      { ...window.history.state, smcDesktopWorkspace: workspace },
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  },
);

/** Reconcile Back/Forward navigation without creating another history entry. */
export const syncDesktopWorkspaceFromLocationAtom = atom(
  null,
  (_get, set, search?: string) => {
    const currentSearch =
      search ?? (typeof window !== "undefined" ? window.location.search : "");
    set(desktopWorkspaceAtom, desktopWorkspaceFromSearch(currentSearch));
  },
);

export const toggleGridAtom = atom(null, (get, set) => {
  const gridVisible = !get(gridVisibleAtom);
  set(gridVisibleAtom, gridVisible);
  persistUI(get, { gridVisible });
  queueRemoteUISettings(get, set, { gridVisible });
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
    queueRemoteUISettings(get, set, { panels });
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
    persistUI(get, { panels, bottomOpen: true, bottomTab: tab });
    queueRemoteUISettings(get, set, { panels, bottomOpen: true, bottomTab: tab });
  } else {
    persistUI(get, { bottomOpen: true, bottomTab: tab });
    queueRemoteUISettings(get, set, { bottomOpen: true, bottomTab: tab });
  }
});

export const toggleRightAtom = atom(null, (get, set) => {
  const rightOpen = !get(rightOpenAtom);
  set(rightOpenAtom, rightOpen);
  persistUI(get, { rightOpen });
  queueRemoteUISettings(get, set, { rightOpen });
});

export const showRightPanelTabAtom = atom(
  null,
  (get, set, tab: RightPanelTab) => {
    set(rightPanelTabAtom, tab);
    set(rightOpenAtom, true);
    persistUI(get, { rightPanelTab: tab, rightOpen: true });
    queueRemoteUISettings(get, set, { rightPanelTab: tab, rightOpen: true });
  },
);

export const toggleBottomAtom = atom(null, (get, set) => {
  const open = !get(bottomOpenAtom);
  set(bottomOpenAtom, open);
  persistUI(get, { bottomOpen: open });
  queueRemoteUISettings(get, set, { bottomOpen: open });
});

export const setBottomOpenAtom = atom(null, (get, set, open: boolean) => {
  set(bottomOpenAtom, open);
  persistUI(get, { bottomOpen: open });
  queueRemoteUISettings(get, set, { bottomOpen: open });
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
  const persisted = normalizeUISettings(
    localStore.get<unknown>("ui", null),
    persistedUISettings(get),
  );
  applyUISettings(set, persisted);
  set(
    desktopWorkspaceAtom,
    desktopWorkspaceFromSearch(
      typeof window !== "undefined" ? window.location.search : "",
    ),
  );
  applyThemeToDocument(persisted.theme);
});

export function desktopWorkspaceFromSearch(search: string): DesktopWorkspace {
  return new URLSearchParams(search).get("workspace") === "trade"
    ? "trade"
    : "chart";
}

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

function normalizeTheme(value: unknown, fallback: Theme): Theme {
  return value === "dark" || value === "light" ? value : fallback;
}

function normalizeBottomTab(value: unknown, fallback: BottomTab): BottomTab {
  return value === "replay" ||
    value === "journal" ||
    value === "analytics" ||
    value === "pine" ||
    value === "logs"
    ? value
    : fallback;
}

function normalizeRightPanelTab(
  value: unknown,
  fallback: RightPanelTab,
): RightPanelTab {
  return value === "watchlist" || value === "objects" ? value : fallback;
}

function persistedUISettings(
  get: Getter,
  overrides: Partial<PersistedUISettings> = {},
): PersistedUISettings {
  return {
    theme: overrides.theme ?? get(themeAtom),
    panels: overrides.panels ?? get(panelsAtom),
    bottomTab: overrides.bottomTab ?? get(bottomTabAtom),
    rightOpen: overrides.rightOpen ?? get(rightOpenAtom),
    rightPanelTab: overrides.rightPanelTab ?? get(rightPanelTabAtom),
    bottomOpen: overrides.bottomOpen ?? get(bottomOpenAtom),
    gridVisible: overrides.gridVisible ?? get(gridVisibleAtom),
  };
}

function normalizeUISettings(
  value: unknown,
  fallback: PersistedUISettings,
): PersistedUISettings {
  if (!isObject(value)) return fallback;
  return {
    theme: normalizeTheme(value.theme, fallback.theme),
    panels: sanitizePanels(value.panels, fallback.panels),
    bottomTab: normalizeBottomTab(value.bottomTab, fallback.bottomTab),
    rightOpen: normalizeBoolean(value.rightOpen, fallback.rightOpen),
    rightPanelTab: normalizeRightPanelTab(
      value.rightPanelTab,
      fallback.rightPanelTab,
    ),
    bottomOpen: normalizeBoolean(value.bottomOpen, fallback.bottomOpen),
    gridVisible: normalizeBoolean(value.gridVisible, fallback.gridVisible),
  };
}

function applyUISettings(set: Setter, settings: PersistedUISettings): void {
  set(themeAtom, settings.theme);
  set(panelsAtom, settings.panels);
  set(bottomTabAtom, settings.bottomTab);
  set(rightOpenAtom, settings.rightOpen);
  set(rightPanelTabAtom, settings.rightPanelTab);
  set(bottomOpenAtom, settings.bottomOpen);
  set(gridVisibleAtom, settings.gridVisible);
}

function persistUI(
  get: Getter,
  overrides: Partial<PersistedUISettings> = {},
): void {
  localStore.set("ui", persistedUISettings(get, overrides));
}

function queueRemoteUISettings(
  get: Getter,
  set: Setter,
  overrides: Partial<PersistedUISettings> = {},
): void {
  if (!get(backendSessionAtom)) return;
  uiSettingsSync.enqueue(persistedUISettings(get, overrides), (error) => {
    const message = error instanceof Error ? error.message : String(error);
    set(logAtom, "error", `UI settings sync failed: ${message}`);
  });
}

export const applyRemoteUISettingsAtom = atom(
  null,
  (get, set, payload: unknown) => {
    uiSettingsSync.cancelPending();
    const settings = normalizeUISettings(payload, persistedUISettings(get));
    applyUISettings(set, settings);
    localStore.set("ui", settings);
    applyThemeToDocument(settings.theme);
  },
);

export interface SavedPanelLayout {
  sizes: PanelSizes;
  rightOpen: boolean;
  bottomOpen: boolean;
  bottomTab: BottomTab;
}

export const applySavedPanelLayoutAtom = atom(
  null,
  (get, set, snapshot: SavedPanelLayout) => {
    const panels = sanitizePanels(snapshot?.sizes, get(panelsAtom));
    const bottomTab: BottomTab = [
      "replay",
      "journal",
      "analytics",
      "pine",
      "logs",
    ].includes(snapshot?.bottomTab)
      ? snapshot.bottomTab
      : get(bottomTabAtom);
    const rightOpen = normalizeBoolean(snapshot?.rightOpen, get(rightOpenAtom));
    const bottomOpen = normalizeBoolean(snapshot?.bottomOpen, get(bottomOpenAtom));
    set(panelsAtom, panels);
    set(rightOpenAtom, rightOpen);
    set(bottomOpenAtom, bottomOpen);
    set(bottomTabAtom, bottomTab);
    const patch = { panels, rightOpen, bottomOpen, bottomTab };
    persistUI(get, patch);
  },
);

// ---------------------------------------------------------------------------
// Non-React accessor — mirrors `useUIStore.getState()` for non-React code.
// ---------------------------------------------------------------------------
export const resetUIToDefaultsAtom = atom(null, (_get, set) => {
  uiSettingsSync.cancelPending();
  const panels = { ...DEFAULT_PANELS };
  set(themeAtom, "dark");
  set(desktopWorkspaceAtom, "chart");
  set(panelsAtom, panels);
  set(bottomTabAtom, "replay");
  set(rightOpenAtom, true);
  set(rightPanelTabAtom, DEFAULT_UI_SETTINGS.rightPanelTab);
  set(bottomOpenAtom, DEFAULT_UI_SETTINGS.bottomOpen);
  set(fullscreenAtom, false);
  set(alertCenterOpenAtom, false);
  set(gridVisibleAtom, true);
  localStore.remove("ui");
  applyThemeToDocument("dark");
});

export function getUIState() {
  const store = getDefaultStore();
  return {
    theme: store.get(themeAtom),
    desktopWorkspace: store.get(desktopWorkspaceAtom),
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
