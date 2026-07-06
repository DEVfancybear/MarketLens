"use client";
import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { authUserAtom, backendSessionAtom } from "@/store/authStore";
import { applyRemoteUISettingsAtom, logAtom } from "@/store/uiStore";
import { applyRemoteSmcSettingsAtom } from "@/store/smcStore";
import { applyRemoteNotificationSettingsAtom } from "@/store/alertStore";
import { applyRemoteWatchlistsAtom } from "@/store/watchlistStore";
import { getWorkspaceBootstrap } from "@/services/api/resources/syncApi";
import { createWatchlist as createRemoteWatchlist } from "@/services/api/resources/watchlistsApi";
import { isApiError } from "@/services/api/errors";

/**
 * Hydrates frontend stores from the backend Phase 5 bootstrap endpoint.
 *
 * Auth/session establishment stays in useAuthSession(). This hook runs after
 * `backendSessionAtom` flips true and applies server-owned sections into atoms.
 * Anonymous users keep the existing localStorage path.
 */
export function useWorkspaceBootstrap(): void {
  const backendSession = useAtomValue(backendSessionAtom);
  const user = useAtomValue(authUserAtom);
  const applyUI = useSetAtom(applyRemoteUISettingsAtom);
  const applySmc = useSetAtom(applyRemoteSmcSettingsAtom);
  const applyNotifications = useSetAtom(applyRemoteNotificationSettingsAtom);
  const applyWatchlists = useSetAtom(applyRemoteWatchlistsAtom);
  const log = useSetAtom(logAtom);
  const bootstrappedUserRef = useRef<string | null>(null);

  useEffect(() => {
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
    applyNotifications,
    applySmc,
    applyUI,
    applyWatchlists,
    backendSession,
    log,
    user,
  ]);
}
