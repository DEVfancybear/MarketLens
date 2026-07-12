"use client";

import { useSyncExternalStore } from "react";

export type ViewportMode = "phone" | "tablet" | "desktop";
export type PointerMode = "coarse" | "fine";

export const RESPONSIVE_BREAKPOINTS = {
  phoneMax: 767,
  tabletMax: 1199,
} as const;

export interface ViewportState {
  width: number;
  height: number;
  mode: ViewportMode;
  orientation: "portrait" | "landscape";
  pointer: PointerMode;
  hover: boolean;
}

const SERVER_SNAPSHOT: ViewportState = {
  width: 1440,
  height: 900,
  mode: "desktop",
  orientation: "landscape",
  pointer: "fine",
  hover: true,
};

let cachedSnapshot = SERVER_SNAPSHOT;

export function viewportModeFor(
  width: number,
  pointer: PointerMode = "fine",
): ViewportMode {
  if (width <= RESPONSIVE_BREAKPOINTS.phoneMax) return "phone";
  if (width <= RESPONSIVE_BREAKPOINTS.tabletMax || pointer === "coarse") {
    return "tablet";
  }
  return "desktop";
}

function readSnapshot(): ViewportState {
  const width = window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  const pointer: PointerMode = window.matchMedia("(pointer: coarse)").matches
    ? "coarse"
    : "fine";
  const next: ViewportState = {
    width,
    height,
    mode: viewportModeFor(width, pointer),
    orientation: width >= height ? "landscape" : "portrait",
    pointer,
    hover: window.matchMedia("(hover: hover)").matches,
  };

  if (
    next.width === cachedSnapshot.width &&
    next.height === cachedSnapshot.height &&
    next.mode === cachedSnapshot.mode &&
    next.orientation === cachedSnapshot.orientation &&
    next.pointer === cachedSnapshot.pointer &&
    next.hover === cachedSnapshot.hover
  ) {
    return cachedSnapshot;
  }
  cachedSnapshot = next;
  return cachedSnapshot;
}

function subscribe(onStoreChange: () => void) {
  const coarse = window.matchMedia("(pointer: coarse)");
  const hover = window.matchMedia("(hover: hover)");
  const visualViewport = window.visualViewport;
  const notify = () => onStoreChange();

  window.addEventListener("resize", notify, { passive: true });
  window.addEventListener("orientationchange", notify, { passive: true });
  visualViewport?.addEventListener("resize", notify, { passive: true });
  coarse.addEventListener("change", notify);
  hover.addEventListener("change", notify);

  return () => {
    window.removeEventListener("resize", notify);
    window.removeEventListener("orientationchange", notify);
    visualViewport?.removeEventListener("resize", notify);
    coarse.removeEventListener("change", notify);
    hover.removeEventListener("change", notify);
  };
}

export function useViewport(): ViewportState {
  return useSyncExternalStore(subscribe, readSnapshot, () => SERVER_SNAPSHOT);
}
