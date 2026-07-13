export type TerminalPlatform = "desktop" | "mobile";

export interface PlatformSignals {
  width: number;
  coarsePointer: boolean;
}

/** Tablets and touch-first laptops intentionally use the mobile application shell. */
export function resolveTerminalPlatform({ width, coarsePointer }: PlatformSignals): TerminalPlatform {
  return width >= 1100 && !coarsePointer ? "desktop" : "mobile";
}
