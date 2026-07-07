"use client";
import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  marketSymbolsAtom,
  refreshMt5SymbolCatalogAtom,
} from "@/store/marketSymbolStore";

const RETRY_INTERVAL_MS = 4000;

/**
 * Loads the MT5 symbol catalog from the backend. The catalog is the single
 * source of tradable symbols, so if the first fetch comes back empty — e.g. the
 * MT5 bridge is still connecting, or the backend started after the page — we
 * keep polling until symbols arrive, then stop. Without this the watchlist and
 * chart stay permanently empty whenever the frontend loads before the bridge.
 */
export function useMt5SymbolCatalog(): void {
  const refresh = useSetAtom(refreshMt5SymbolCatalogAtom);
  const hasSymbols = useAtomValue(marketSymbolsAtom).length > 0;

  useEffect(() => {
    let cancelled = false;

    // Always refresh once on mount. Existing local/runtime symbols can be stale
    // after a deploy or from a previous localStorage session; the backend MT5
    // catalog is the source of truth and must be queried even when the registry
    // is not empty.
    void refresh();
    if (hasSymbols) {
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setInterval(() => {
      if (!cancelled) void refresh();
    }, RETRY_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refresh, hasSymbols]);
}
