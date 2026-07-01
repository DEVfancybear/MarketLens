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

    const sync = (keepalive = false) =>
      syncServerPushAlerts(
        {
          token: registration.token,
          settingsPush: settings.push,
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
  }, [alerts, registration?.permission, registration?.token, settings.push]);
}
