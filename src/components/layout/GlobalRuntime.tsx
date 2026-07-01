"use client";
import { useReplayPlayback } from "@/hooks/useReplayPlayback";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useSmcEngine } from "@/hooks/useSmcEngine";
import { useTradeRuntime } from "@/hooks/useTradeRuntime";
import { useMarketDataBootstrap } from "@/hooks/useMarketDataBootstrap";
import { useAlertEngine } from "@/hooks/useAlertEngine";
import { loadJournalAtom } from "@/store/journalStore";
import { useSetAtom } from "jotai";
import { hydrateAtom as hydrateAlertsAtom } from "@/store/alertStore";
import { hydratePushAtom } from "@/store/notificationStore";
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

  // Hydrate journal + alerts from persisted storage (IndexedDB / localStorage).
  const loadJournal = useSetAtom(loadJournalAtom);
  const hydrateAlerts = useSetAtom(hydrateAlertsAtom);
  const hydratePush = useSetAtom(hydratePushAtom);
  useEffect(() => {
    void loadJournal();
    hydrateAlerts();
    hydratePush();
  }, [loadJournal, hydrateAlerts, hydratePush]);

  return null;
}
