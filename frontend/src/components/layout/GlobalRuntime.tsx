"use client";
import { ReplayClientRuntime } from "@/components/replay/ReplayClientRuntime";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useSmcEngine } from "@/hooks/useSmcEngine";
import { useTradeRuntime } from "@/hooks/useTradeRuntime";
import { useMarketDataBootstrap } from "@/hooks/useMarketDataBootstrap";
import { useMt5SymbolCatalog } from "@/hooks/useMt5SymbolCatalog";
import { useAlertEngine } from "@/hooks/useAlertEngine";
import { usePushAlertSync } from "@/hooks/usePushAlertSync";
import { usePushTriggerReconcile } from "@/hooks/usePushTriggerReconcile";
import { useMt5Bridge } from "@/hooks/useMt5Bridge";
import { useMt5IntegrationAccess } from "@/hooks/useMt5IntegrationAccess";
import { useAuthSession } from "@/hooks/useAuthSession";
import { useWorkspaceBootstrap } from "@/hooks/useWorkspaceBootstrap";
import { useChartLayoutPersistence } from "@/hooks/useChartLayoutPersistence";
import { useNotificationDeepLink } from "@/hooks/useNotificationDeepLink";
import { useSetAtom } from "jotai";
import { hydrateAtom as hydrateAlertsAtom } from "@/store/alertStore";
import { hydratePushAtom } from "@/store/notificationStore";
import { useEffect } from "react";
import { QuickTimeframeSwitcher } from "@/components/toolbar/QuickTimeframeSwitcher";

/**
 * Headless component that mounts global runtime integrations. Replay timing is
 * owned by the Go session actor; this component mounts transport only.
 */
export function GlobalRuntime() {
  useHotkeys();
  useSmcEngine();
  useTradeRuntime();
  useMt5SymbolCatalog(); // loads MT5 symbols from backend; no third-party symbol API
  useMarketDataBootstrap(); // brings the realtime feed online + subscribes watchlist tickers
  useAlertEngine(); // evaluates price alerts off the same realtime feed (no polling/sockets)
  usePushAlertSync(); // keeps server-side push worker state in sync for closed-browser alerts
  usePushTriggerReconcile(); // pulls back server-confirmed closed-browser triggers the client's own scan missed
  useAuthSession(); // bridges Firebase Google auth -> authStore (+ best-effort backend session)
  useWorkspaceBootstrap(); // applies backend settings/watchlists after backend auth
  useChartLayoutPersistence(); // autosaves/restores the active multi-chart projection
  useMt5IntegrationAccess(); // loads verified MT5 access for the current backend user only
  useMt5Bridge(); // connects the host-local bridge only for a verified user
  useNotificationDeepLink(); // routes notification clicks to the alert symbol

  // Journal is intentionally lazy-loaded by its panel (Phase 11 can include
  // screenshot metadata); the small alert stores still hydrate globally.
  const hydrateAlerts = useSetAtom(hydrateAlertsAtom);
  const hydratePush = useSetAtom(hydratePushAtom);
  useEffect(() => {
    hydrateAlerts();
    hydratePush();
  }, [hydrateAlerts, hydratePush]);

  return (
    <>
      <ReplayClientRuntime />
      <QuickTimeframeSwitcher />
    </>
  );
}
