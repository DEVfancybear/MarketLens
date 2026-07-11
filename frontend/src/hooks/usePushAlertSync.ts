"use client";
import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { alertsAtom, settingsAtom } from "@/store/alertStore";
import { pushRegistrationAtom } from "@/store/notificationStore";
import { syncServerPushAlerts } from "@/services/notifications/push";
import { useExternalSyncToken } from "@/hooks/useExternalSyncToken";
import { workspaceReadyAtom } from "@/store/authStore";
import { getIntegrationSettings } from "@/services/api/resources/integrationsApi";

export function usePushAlertSync() {
  const alerts = useAtomValue(alertsAtom);
  const settings = useAtomValue(settingsAtom);
  const registration = useAtomValue(pushRegistrationAtom);
  const externalSyncToken = useExternalSyncToken();
  const workspaceReady = useAtomValue(workspaceReadyAtom);
  const [deliveryToken, setDeliveryToken] = useState<string>();

  useEffect(() => {
    if (!workspaceReady) { setDeliveryToken(undefined); return; }
    void getIntegrationSettings().then((v)=>setDeliveryToken(v.deliveryToken)).catch(()=>setDeliveryToken(undefined));
  }, [workspaceReady]);

  useEffect(() => {
    if (!workspaceReady) return;
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
        : [];

    const sync = (keepalive = false) =>
      syncServerPushAlerts(
        {
          token: syncToken,
          deliveryToken,
          settingsPush: canSyncPush,
          settingsTelegram: settings.telegram,
          settingsDiscord: settings.discord,
          alerts: pushAlerts,
        },
        { keepalive },
      );

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
    deliveryToken,
    externalSyncToken,
    registration?.permission,
    registration?.token,
    settings.discord,
    settings.push,
    settings.telegram,
    workspaceReady,
  ]);
}
