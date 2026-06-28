"use client";
import { create } from "zustand";
import { localStore } from "@/services/storage";

export type Theme = "dark" | "light";

/** Which bottom-panel tab is active. */
export type BottomTab = "replay" | "trade" | "journal" | "analytics" | "logs";

interface PanelSizes {
  /** Right watchlist width (px). */
  right: number;
  /** Bottom panel height (px). */
  bottom: number;
  /** Left toolbar width (px) — fixed, but kept for completeness. */
  left: number;
}

interface UIState {
  theme: Theme;
  panels: PanelSizes;
  bottomTab: BottomTab;
  rightOpen: boolean;
  bottomOpen: boolean;
  fullscreen: boolean;
  /** Alert Center slide-over drawer visibility. */
  alertCenterOpen: boolean;
  /** TradingView-style chart grid visibility (chart-settings toggle). */
  gridVisible: boolean;
  logs: {
    id: number;
    time: number;
    level: "info" | "warn" | "error";
    msg: string;
  }[];

  setTheme: (t: Theme) => void;
  toggleGrid: () => void;
  toggleTheme: () => void;
  setPanel: (key: keyof PanelSizes, value: number) => void;
  setBottomTab: (t: BottomTab) => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  setFullscreen: (v: boolean) => void;
  toggleAlertCenter: () => void;
  setAlertCenter: (v: boolean) => void;
  log: (level: "info" | "warn" | "error", msg: string) => void;
  /** Load persisted UI prefs from localStorage. Call once on the client. */
  hydrate: () => void;
}

// SSR-safe deterministic defaults — identical on server and first client render.
// Persisted values are loaded later via hydrate() to avoid hydration mismatches.
const DEFAULT_PANELS: PanelSizes = { right: 320, bottom: 240, left: 52 };

let logId = 0;

export const useUIStore = create<UIState>((set, get) => ({
  theme: "dark",
  panels: DEFAULT_PANELS,
  bottomTab: "replay",
  rightOpen: true,
  bottomOpen: true,
  fullscreen: false,
  alertCenterOpen: false,
  gridVisible: true,
  logs: [],

  hydrate: () => {
    const persisted = localStore.get("ui", {
      theme: get().theme,
      panels: get().panels,
    });
    set({ theme: persisted.theme, panels: persisted.panels });
    if (typeof document !== "undefined") {
      document.documentElement.className = `theme-${persisted.theme}`;
    }
  },

  setTheme: (theme) => {
    set({ theme });
    localStore.set("ui", { theme, panels: get().panels });
    if (typeof document !== "undefined") {
      document.documentElement.className = `theme-${theme}`;
    }
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

  toggleGrid: () => set((s) => ({ gridVisible: !s.gridVisible })),

  setPanel: (key, value) => {
    const panels = { ...get().panels, [key]: value };
    set({ panels });
    localStore.set("ui", { theme: get().theme, panels });
  },

  setBottomTab: (bottomTab) => set({ bottomTab, bottomOpen: true }),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
  setFullscreen: (fullscreen) => set({ fullscreen }),
  toggleAlertCenter: () =>
    set((s) => ({ alertCenterOpen: !s.alertCenterOpen })),
  setAlertCenter: (alertCenterOpen) => set({ alertCenterOpen }),

  log: (level, msg) =>
    set((s) => ({
      logs: [
        { id: ++logId, time: Date.now() / 1000, level, msg },
        ...s.logs,
      ].slice(0, 200),
    })),
}));
