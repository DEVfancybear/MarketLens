"use client";
import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { alertsAtom, settingsAtom } from "@/store/alertStore";
import { pushRegistrationAtom } from "@/store/notificationStore";
import { syncServerPushAlerts } from "@/services/notifications/push";

export function usePushAlertSync() {
  const alerts = useAtomValue(alertsAtom);
  const settings = useAtomValue(settingsAtom);
  const registration = useAtomValue(pushRegistrationAtom);

  useEffect(() => {
    if (!registration?.token) return;

    const pushAlerts =
      settings.push && registration.permission === "granted"
        ? alerts.filter((alert) => alert.enabled && alert.push)
        : [];

    const handle = window.setTimeout(() => {
      void syncServerPushAlerts({
        token: registration.token,
        settingsPush: settings.push,
        alerts: pushAlerts,
      });
    }, 250);

    return () => window.clearTimeout(handle);
  }, [alerts, registration?.permission, registration?.token, settings.push]);
}
