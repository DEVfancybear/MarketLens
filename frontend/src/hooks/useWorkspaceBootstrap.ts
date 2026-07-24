"use client";
import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  authStatusAtom,
  authUserAtom,
  backendSessionAtom,
  backendSessionResolvedAtom,
  setWorkspaceReadyAtom,
} from "@/store/authStore";
import {
  applyRemoteUISettingsAtom,
  logAtom,
  resetUIToDefaultsAtom,
} from "@/store/uiStore";
import {
  applyRemoteSmcSettingsAtom,
  resetSmcToDefaultsAtom,
} from "@/store/smcStore";
import {
  applyRemoteAlertsAtom,
  applyRemoteNotificationSettingsAtom,
  resetAlertsToDefaultsAtom,
} from "@/store/alertStore";
import { applyRemoteWatchlistsAtom } from "@/store/watchlistStore";
import {
  applyRemoteIndicatorsAtom,
  applyRemoteChartSettingsAtom,
  applyRemoteDrawingTemplatesAtom,
  applyRemotePineScriptsAtom,
  hydrateAtom as hydrateChartAtom,
  loadActiveSymbolDrawingsAtom,
  resetChartWorkspaceToDefaultsAtom,
} from "@/store/chartStore";
import { resetTradeAtom } from "@/store/tradeStore";
import { resetNotificationsToDefaultsAtom } from "@/store/notificationStore";
import {
  applyRemoteLayoutsAtom,
  loadDefaultLayoutAtom,
} from "@/store/layoutStore";
import { resetChartLayoutStateAtom } from "@/store/replayLayoutStore";
import { getWorkspaceBootstrap } from "@/services/api/resources/syncApi";
import { createWatchlist as createRemoteWatchlist } from "@/services/api/resources/watchlistsApi";
import {
  reportFrontendError,
  userFacingErrorMessage,
} from "@/services/feedback/errorReporter";

/**
 * Hydrates frontend stores from the backend Phase 5 bootstrap endpoint.
 *
 * Auth/session establishment stays in useAuthSession(). This hook runs after
 * `backendSessionAtom` flips true and applies server-owned sections into atoms.
 * Watchlists are no longer localStorage-backed. Anonymous/offline chart edits
 * hydrate from the local cache; an explicit sign-out clears that cache before
 * the next account can use the browser.
 */
export function useWorkspaceBootstrap(): void {
  const authStatus = useAtomValue(authStatusAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const backendSessionResolved = useAtomValue(backendSessionResolvedAtom);
  const user = useAtomValue(authUserAtom);
  const applyUI = useSetAtom(applyRemoteUISettingsAtom);
  const resetUI = useSetAtom(resetUIToDefaultsAtom);
  const applySmc = useSetAtom(applyRemoteSmcSettingsAtom);
  const resetSmc = useSetAtom(resetSmcToDefaultsAtom);
  const applyNotifications = useSetAtom(applyRemoteNotificationSettingsAtom);
  const applyAlerts = useSetAtom(applyRemoteAlertsAtom);
  const resetAlerts = useSetAtom(resetAlertsToDefaultsAtom);
  const applyWatchlists = useSetAtom(applyRemoteWatchlistsAtom);
  const applyDrawingTemplates = useSetAtom(applyRemoteDrawingTemplatesAtom);
  const applyPineScripts = useSetAtom(applyRemotePineScriptsAtom);
  const applyIndicators = useSetAtom(applyRemoteIndicatorsAtom);
  const applyChartSettings = useSetAtom(applyRemoteChartSettingsAtom);
  const hydrateChart = useSetAtom(hydrateChartAtom);
  const loadActiveDrawings = useSetAtom(loadActiveSymbolDrawingsAtom);
  const resetChartWorkspace = useSetAtom(resetChartWorkspaceToDefaultsAtom);
  const resetTrade = useSetAtom(resetTradeAtom);
  const resetPushNotifications = useSetAtom(resetNotificationsToDefaultsAtom);
  const applyLayouts = useSetAtom(applyRemoteLayoutsAtom);
  const loadDefaultLayout = useSetAtom(loadDefaultLayoutAtom);
  const resetChartLayout = useSetAtom(resetChartLayoutStateAtom);
  const setWorkspaceReady = useSetAtom(setWorkspaceReadyAtom);
  const log = useSetAtom(logAtom);
  const bootstrappedUserRef = useRef<string | null>(null);
  const anonymousResetRef = useRef(false);
  const authenticatedBeforeAnonymousRef = useRef(false);

  useEffect(() => {
    if (authStatus === "anonymous") {
      bootstrappedUserRef.current = null;
      if (!anonymousResetRef.current) {
        anonymousResetRef.current = true;
        const signedOut = authenticatedBeforeAnonymousRef.current;
        if (signedOut) {
          resetUI();
          resetSmc();
          resetAlerts();
          applyWatchlists([]);
          applyLayouts([]);
          resetChartLayout();
          resetChartWorkspace({ clearLocal: true });
          resetTrade();
          resetPushNotifications();
        } else {
          // Initial/offline anonymous sessions may use the local cache. The
          // hydration hook ran before this effect, so rehydrate after resetting
          // the SSR-safe atoms without deleting the cache.
          resetChartWorkspace({ clearLocal: false });
          resetChartLayout();
          hydrateChart();
        }
        log("info", "Workspace reset to defaults");
      }
      setWorkspaceReady(true);
      return;
    }

    if (authStatus === "loading" || authStatus === "authenticating") {
      setWorkspaceReady(false);
      return;
    }

    anonymousResetRef.current = false;
    authenticatedBeforeAnonymousRef.current = true;

    if (!backendSession || !user) {
      bootstrappedUserRef.current = null;
      setWorkspaceReady(backendSessionResolved);
      return;
    }
    if (bootstrappedUserRef.current === user.uid) return;

    let cancelled = false;
    bootstrappedUserRef.current = user.uid;
    setWorkspaceReady(false);

    void getWorkspaceBootstrap()
      .then(async (bootstrap) => {
        if (cancelled) return;
        let watchlists = bootstrap.watchlists;
        if (!watchlists.length) {
          try {
            watchlists = [await createRemoteWatchlist("Watchlist")];
          } catch (error) {
            const message = userFacingErrorMessage(
              error,
              "default watchlist create failed",
            );
            log("warn", `Default watchlist was not created on backend: ${message}`);
          }
        }
        if (cancelled) return;
        applyUI(bootstrap.settings.ui);
        applySmc(bootstrap.settings.smc);
        applyNotifications(bootstrap.settings.notifications);
        applyAlerts({
          alerts: bootstrap.alerts,
          triggeredAlerts: bootstrap.triggeredAlerts,
          expiredAlerts: bootstrap.expiredAlerts ?? [],
          history: bootstrap.history,
        });
        applyWatchlists(watchlists);
        applyDrawingTemplates(bootstrap.drawingTemplates);
        applyPineScripts(bootstrap.pineScripts);
        applyIndicators(bootstrap.indicators);
        applyLayouts(bootstrap.layouts);
        const loadedDefaultLayout = loadDefaultLayout();
        // A default layout restores its arrangement and pane payload first, but
        // the user's latest active symbol is a separate account preference and
        // must win on an automatic bootstrap/refresh.
        applyChartSettings(bootstrap.settings.chart);
        if (!loadedDefaultLayout) loadActiveDrawings();
        setWorkspaceReady(true);
        log("info", "Workspace synced from backend");
      })
      .catch((error) => {
        if (cancelled) return;
        bootstrappedUserRef.current = null;
        setWorkspaceReady(true);
        reportFrontendError(error, {
          title: "Workspace sync failed",
          logPrefix: "Workspace bootstrap failed",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    authStatus,
    applyAlerts,
    applyNotifications,
    applyDrawingTemplates,
    applyPineScripts,
    applyIndicators,
    applyChartSettings,
    hydrateChart,
    applyLayouts,
    loadActiveDrawings,
    loadDefaultLayout,
    applySmc,
    applyUI,
    applyWatchlists,
    backendSession,
    backendSessionResolved,
    log,
    resetAlerts,
    resetChartLayout,
    resetChartWorkspace,
    resetPushNotifications,
    resetSmc,
    resetTrade,
    resetUI,
    setWorkspaceReady,
    user,
  ]);
}
