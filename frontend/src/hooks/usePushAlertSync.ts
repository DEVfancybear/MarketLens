"use client";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { alertsAtom, settingsAtom } from "@/store/alertStore";
import { pushRegistrationAtom } from "@/store/notificationStore";
import { syncServerPushAlerts } from "@/services/notifications/push";
import { useExternalSyncToken } from "@/hooks/useExternalSyncToken";
import { workspaceReadyAtom } from "@/store/authStore";
import { resolvedChartTimeZoneAtom } from "@/store/chartStore";
import { getIntegrationSettings } from "@/services/api/resources/integrationsApi";
import {
  canSyncClosedBrowserAlerts,
  type WorkerDeliveryCredential,
  workerCredentialRetryDelay,
} from "@/services/notifications/pushSyncPolicy";
import { marketSymbolsAtom } from "@/store/marketSymbolStore";
import {
  normalizeAlertSymbol,
  resolveAlertSymbol,
} from "@/services/alertSymbols";
import { reportFrontendError } from "@/services/feedback/errorReporter";

export function usePushAlertSync() {
  const alerts = useAtomValue(alertsAtom);
  const settings = useAtomValue(settingsAtom);
  const registration = useAtomValue(pushRegistrationAtom);
  const externalSyncToken = useExternalSyncToken();
  const workspaceReady = useAtomValue(workspaceReadyAtom);
  const notificationTimeZone = useAtomValue(resolvedChartTimeZoneAtom);
  const marketSymbols = useAtomValue(marketSymbolsAtom);
  const [credential, setCredential] = useState<WorkerDeliveryCredential>({
    status: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    let retryHandle: number | undefined;
    let retryAttempt = 0;

    if (!workspaceReady) {
      setCredential({ status: "idle" });
      return () => {
        cancelled = true;
      };
    }

    const loadCredential = async () => {
      setCredential({ status: "loading" });
      try {
        const value = await getIntegrationSettings();
        if (cancelled) return;
        const token = value.deliveryToken.trim();
        if (!token) throw new Error("Signed delivery token is unavailable.");
        retryAttempt = 0;
        if (retryHandle !== undefined) {
          window.clearTimeout(retryHandle);
          retryHandle = undefined;
        }
        setCredential({ status: "ready", token });
      } catch {
        if (cancelled) return;
        setCredential({ status: "failed" });
        const delay = workerCredentialRetryDelay(retryAttempt);
        retryAttempt += 1;
        retryHandle = window.setTimeout(() => {
          retryHandle = undefined;
          if (!cancelled) void loadCredential();
        }, delay);
      }
    };

    void loadCredential();
    return () => {
      cancelled = true;
      if (retryHandle !== undefined) window.clearTimeout(retryHandle);
    };
  }, [workspaceReady]);

  useEffect(() => {
    if (!canSyncClosedBrowserAlerts(workspaceReady, credential)) return;
    const syncToken = registration?.token ?? externalSyncToken;
    const hasExternalAlertFlags = alerts.some(
      (alert) => alert.telegram || alert.discord,
    );
    const shouldSync =
      Boolean(registration?.token) ||
      settings.telegram ||
      settings.discord ||
      hasExternalAlertFlags;
    if (!syncToken || !shouldSync) return;

    const canSyncPush =
      Boolean(registration?.token) &&
      settings.push &&
      registration?.permission === "granted";
    const canSyncExternal = settings.telegram || settings.discord;
    const pushAlerts =
      canSyncPush || canSyncExternal
        ? alerts.filter(
            (alert) =>
              alert.enabled &&
              ((canSyncPush && alert.push) ||
                (settings.telegram && alert.telegram) ||
                (settings.discord && alert.discord)),
          )
          .map((alert) => ({
            ...alert,
            symbol:
              resolveAlertSymbol(alert.symbol, marketSymbols) ??
              normalizeAlertSymbol(alert.symbol),
          }))
        : [];

    const sync = async (keepalive = false) => {
      const result = await syncServerPushAlerts(
        {
          token: syncToken,
          deliveryToken: credential.token,
          notificationTimeZone,
          settingsPush: canSyncPush,
          settingsTelegram: settings.telegram,
          settingsDiscord: settings.discord,
          alerts: pushAlerts,
        },
        { keepalive },
      );
      if (!result.ok) {
        reportFrontendError(new Error(result.error), {
          title: "Alert push sync failed",
          logPrefix: "Closed-browser alert snapshot sync failed",
          toast: false,
        });
      }
      return result;
    };

    const handle = window.setTimeout(() => {
      void sync();
    }, 250);

    const flush = () => {
      window.clearTimeout(handle);
      void sync(true);
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);

    return () => {
      window.clearTimeout(handle);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [
    alerts,
    credential,
    externalSyncToken,
    marketSymbols,
    notificationTimeZone,
    registration?.permission,
    registration?.token,
    settings.discord,
    settings.push,
    settings.telegram,
    workspaceReady,
  ]);
}
