"use client";
import { useReplayPlayback } from "@/hooks/useReplayPlayback";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useSmcEngine } from "@/hooks/useSmcEngine";
import { useTradeRuntime } from "@/hooks/useTradeRuntime";
import { useMarketDataBootstrap } from "@/hooks/useMarketDataBootstrap";
import { useMt5SymbolCatalog } from "@/hooks/useMt5SymbolCatalog";
import { useAlertEngine } from "@/hooks/useAlertEngine";
import { usePushAlertSync } from "@/hooks/usePushAlertSync";
import { usePushTriggerReconcile } from "@/hooks/usePushTriggerReconcile";
import { useMt5Bridge } from "@/hooks/useMt5Bridge";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useWorkspaceBootstrap } from "@/hooks/useWorkspaceBootstrap";
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
  useMt5SymbolCatalog(); // loads MT5 symbols from backend; no third-party symbol API
  useMarketDataBootstrap(); // brings the realtime feed online + subscribes watchlist tickers
  useAlertEngine(); // evaluates price alerts off the same realtime feed (no polling/sockets)
  usePushAlertSync(); // keeps server-side push worker state in sync for closed-browser alerts
  usePushTriggerReconcile(); // pulls back server-confirmed closed-browser triggers the client's own scan missed
  useMt5Bridge(); // feature-flagged MT5 bridge runtime; disabled by default
  useAuthSession(); // bridges Firebase Google auth -> authStore (+ best-effort backend session)
  useWorkspaceBootstrap(); // applies backend settings/watchlists after backend auth

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
