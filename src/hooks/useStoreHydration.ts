"use client";
import { useEffect, useState } from "react";
import { getDefaultStore } from "jotai";
import { hydrateAtom } from "@/store/uiStore";
import { hydrateAtom as hydrateChartAtom } from "@/store/chartStore";
import { hydrateWatchlistAtom } from "@/store/watchlistStore";
import { hydrateSmcAtom } from "@/store/smcStore";

/**
 * Loads all persisted (localStorage-backed) store state AFTER mount, then flips
 * a `hydrated` flag. Stores initialise with deterministic SSR-safe defaults, so
 * the server HTML and the first client render always match; persisted values are
 * applied here, post-hydration, where a state update is safe.
 */
export function useStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    getDefaultStore().set(hydrateAtom);
    getDefaultStore().set(hydrateChartAtom);
    getDefaultStore().set(hydrateWatchlistAtom);
    getDefaultStore().set(hydrateSmcAtom);
    setHydrated(true);
  }, []);

  return hydrated;
}
