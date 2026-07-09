"use client";
import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { authStatusAtom, authUserAtom, backendSessionAtom } from "@/store/authStore";
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
  applyRemoteNotificationSettingsAtom,
  resetAlertsToDefaultsAtom,
} from "@/store/alertStore";
import { applyRemoteWatchlistsAtom } from "@/store/watchlistStore";
import {
  applyRemoteIndicatorsAtom,
  applyRemoteDrawingTemplatesAtom,
  loadActiveSymbolDrawingsAtom,
  resetChartWorkspaceToDefaultsAtom,
} from "@/store/chartStore";
import { resetTradeAtom } from "@/store/tradeStore";
import { resetNotificationsToDefaultsAtom } from "@/store/notificationStore";
import { getWorkspaceBootstrap } from "@/services/api/resources/syncApi";
import { createWatchlist as createRemoteWatchlist } from "@/services/api/resources/watchlistsApi";
import { isApiError } from "@/services/api/errors";

/**
 * Hydrates frontend stores from the backend Phase 5 bootstrap endpoint.
 *
 * Auth/session establishment stays in useAuthSession(). This hook runs after
 * `backendSessionAtom` flips true and applies server-owned sections into atoms.
 * Watchlists are no longer localStorage-backed; anonymous/offline edits are only
 * an in-memory cache for the current tab.
 */
export function useWorkspaceBootstrap(): void {
  const authStatus = useAtomValue(authStatusAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const user = useAtomValue(authUserAtom);
  const applyUI = useSetAtom(applyRemoteUISettingsAtom);
  const resetUI = useSetAtom(resetUIToDefaultsAtom);
  const applySmc = useSetAtom(applyRemoteSmcSettingsAtom);
  const resetSmc = useSetAtom(resetSmcToDefaultsAtom);
  const applyNotifications = useSetAtom(applyRemoteNotificationSettingsAtom);
  const resetAlerts = useSetAtom(resetAlertsToDefaultsAtom);
  const applyWatchlists = useSetAtom(applyRemoteWatchlistsAtom);
  const applyDrawingTemplates = useSetAtom(applyRemoteDrawingTemplatesAtom);
  const applyIndicators = useSetAtom(applyRemoteIndicatorsAtom);
  const loadActiveDrawings = useSetAtom(loadActiveSymbolDrawingsAtom);
  const resetChartWorkspace = useSetAtom(resetChartWorkspaceToDefaultsAtom);
  const resetTrade = useSetAtom(resetTradeAtom);
  const resetPushNotifications = useSetAtom(resetNotificationsToDefaultsAtom);
  const log = useSetAtom(logAtom);
  const bootstrappedUserRef = useRef<string | null>(null);
  const anonymousResetRef = useRef(false);

  useEffect(() => {
    if (authStatus === "anonymous") {
      bootstrappedUserRef.current = null;
      if (!anonymousResetRef.current) {
        anonymousResetRef.current = true;
        resetUI();
        resetSmc();
        resetAlerts();
        applyWatchlists([]);
        resetChartWorkspace();
        resetTrade();
        resetPushNotifications();
        log("info", "Workspace reset to defaults");
      }
      return;
    }

    if (authStatus === "loading" || authStatus === "authenticating") {
      return;
    }

    anonymousResetRef.current = false;

    if (!backendSession || !user) {
      bootstrappedUserRef.current = null;
      return;
    }
    if (bootstrappedUserRef.current === user.uid) return;

    let cancelled = false;
    bootstrappedUserRef.current = user.uid;

    void getWorkspaceBootstrap()
      .then(async (bootstrap) => {
        if (cancelled) return;
        let watchlists = bootstrap.watchlists;
        if (!watchlists.length) {
          try {
            watchlists = [await createRemoteWatchlist("Watchlist")];
          } catch (error) {
            const message = isApiError(error)
              ? error.message
              : (error as Error)?.message || "default watchlist create failed";
            log("warn", `Default watchlist was not created on backend: ${message}`);
          }
        }
        if (cancelled) return;
        applyUI(bootstrap.settings.ui);
        applySmc(bootstrap.settings.smc);
        applyNotifications(bootstrap.settings.notifications);
        applyWatchlists(watchlists);
        applyDrawingTemplates(bootstrap.drawingTemplates);
        applyIndicators(bootstrap.indicators);
        loadActiveDrawings();
        log("info", "Workspace synced from backend");
      })
      .catch((error) => {
        if (cancelled) return;
        bootstrappedUserRef.current = null;
        const message = isApiError(error)
          ? error.message
          : (error as Error)?.message || "Workspace bootstrap failed";
        log("error", `Workspace bootstrap failed: ${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [
    authStatus,
    applyNotifications,
    applyDrawingTemplates,
    applyIndicators,
    loadActiveDrawings,
    applySmc,
    applyUI,
    applyWatchlists,
    backendSession,
    log,
    resetAlerts,
    resetChartWorkspace,
    resetPushNotifications,
    resetSmc,
    resetTrade,
    resetUI,
    user,
  ]);
}
