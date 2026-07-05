"use client";
import { atom, getDefaultStore } from "jotai";

/** Filter/config state for the analytics dashboard. Heavy computation lives in
 *  analyticsEngine and is memoised in the panel against the journal entries. */
export interface AnalyticsState {
  startingEquity: number;
  symbolFilter: string | "all";
}

// ---------------------------------------------------------------------------
// Individual state atoms
// ---------------------------------------------------------------------------
export const startingEquityAtom = atom<number>(10_000);
export const symbolFilterAtom = atom<string | "all">("all");

// ---------------------------------------------------------------------------
// Derived read-only atom (used by compatibility hook)
// ---------------------------------------------------------------------------
export const analyticsStateAtom = atom<AnalyticsState>((get) => ({
  startingEquity: get(startingEquityAtom),
  symbolFilter: get(symbolFilterAtom),
}));

// ---------------------------------------------------------------------------
// Write atoms (actions)
// ---------------------------------------------------------------------------

export const setStartingEquityAtom = atom(null, (_get, set, v: number) => {
  set(startingEquityAtom, v);
});

export const setSymbolFilterAtom = atom(
  null,
  (_get, set, s: string | "all") => {
    set(symbolFilterAtom, s);
  },
);

// ---------------------------------------------------------------------------
// Non-React accessor — mirrors `useAnalyticsStore.getState()` for non-React code.
// ---------------------------------------------------------------------------
export function getAnalyticsState() {
  const store = getDefaultStore();
  return {
    startingEquity: store.get(startingEquityAtom),
    symbolFilter: store.get(symbolFilterAtom),
  };
}

// ---------------------------------------------------------------------------
// Compatibility hook — mirrors `useAnalyticsStore(selector?)` from Zustand.
// Prefer `useAtomValue(startingEquityAtom)` etc. in new code for optimal rendering.
// ---------------------------------------------------------------------------
import { useAtomValue } from "jotai";
import { useMemo } from "react";

export function useAnalyticsStore(): AnalyticsState;
export function useAnalyticsStore<T>(selector: (state: AnalyticsState) => T): T;
export function useAnalyticsStore<T>(
  selector?: (state: AnalyticsState) => T,
): AnalyticsState | T {
  const state = useAtomValue(analyticsStateAtom);
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMemo(() => selector(state), [state, selector]);
  }
  return state;
}
