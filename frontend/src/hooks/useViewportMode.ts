"use client";

import { useSyncExternalStore } from "react";

export type ViewportMode = "phone" | "tablet" | "desktop";

const PHONE_MAX = 767;
const DESKTOP_MIN = 1024;

function subscribe(onStoreChange: () => void) {
  window.addEventListener("resize", onStoreChange, { passive: true });
  return () => window.removeEventListener("resize", onStoreChange);
}

export function viewportModeForWidth(width: number): ViewportMode {
  if (width <= PHONE_MAX) return "phone";
  if (width < DESKTOP_MIN) return "tablet";
  return "desktop";
}

function getSnapshot(): ViewportMode {
  return viewportModeForWidth(window.innerWidth);
}

export function useViewportMode(): ViewportMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => "desktop");
}
