"use client";

import { useViewport, viewportModeFor, type ViewportMode } from "./useViewport";

export type { ViewportMode } from "./useViewport";

/** Width-only helper retained for tests and non-DOM callers. */
export function viewportModeForWidth(width: number): ViewportMode {
  return viewportModeFor(width, "fine");
}

export function useViewportMode(): ViewportMode {
  return useViewport().mode;
}
