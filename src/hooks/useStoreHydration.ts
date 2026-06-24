'use client';
import { useEffect, useState } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useChartStore } from '@/store/chartStore';
import { useWatchlistStore } from '@/store/watchlistStore';
import { useSmcStore } from '@/store/smcStore';

/**
 * Loads all persisted (localStorage-backed) store state AFTER mount, then flips
 * a `hydrated` flag. Stores initialise with deterministic SSR-safe defaults, so
 * the server HTML and the first client render always match; persisted values are
 * applied here, post-hydration, where a state update is safe.
 */
export function useStoreHydration(): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    useUIStore.getState().hydrate();
    useChartStore.getState().hydrate();
    useWatchlistStore.getState().hydrate();
    useSmcStore.getState().hydrate();
    setHydrated(true);
  }, []);

  return hydrated;
}
