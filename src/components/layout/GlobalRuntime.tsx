"use client";
import { useReplayPlayback } from "@/hooks/useReplayPlayback";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useSmcEngine } from "@/hooks/useSmcEngine";
import { useTradeRuntime } from "@/hooks/useTradeRuntime";
import { useMarketDataBootstrap } from "@/hooks/useMarketDataBootstrap";
import { useAlertEngine } from "@/hooks/useAlertEngine";
import { loadJournalAtom } from "@/store/journalStore";
import { useSetAtom } from "jotai";
import { useAlertStore } from "@/store/alertStore";
import { useEffect } from "react";

/**
 * Headless component that mounts global runtime loops: the replay clock,
 * keyboard shortcuts, and the SMC recompute pipeline. Render once at the root.
 */
export function GlobalRuntime() {
  useReplayPlayback();
  useHotkeys();
  useSmcEngine();
  useTradeRuntime();
  useMarketDataBootstrap(); // brings the realtime feed online + subscribes watchlist tickers
  useAlertEngine(); // evaluates price alerts off the same realtime feed (no polling/sockets)

  // Hydrate the journal from IndexedDB + alerts from localStorage once on mount.
  const loadJournal = useSetAtom(loadJournalAtom);
  const hydrateAlerts = useAlertStore((s) => s.hydrate);
  useEffect(() => {
    void loadJournal();
    hydrateAlerts();
  }, [loadJournal, hydrateAlerts]);

  return null;
}
