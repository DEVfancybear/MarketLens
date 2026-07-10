"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { alertsAtom, triggerAlertAtom, type Alert } from "@/store/alertStore";
import { workspaceReadyAtom } from "@/store/authStore";
import { pushRegistrationAtom } from "@/store/notificationStore";
import { fetchPushTriggerStatus } from "@/services/notifications/push";
import { useExternalSyncToken } from "@/hooks/useExternalSyncToken";

const POLL_INTERVAL_MS = 60_000;

/** Applies closed-browser triggers only after workspace bootstrap has settled. */
export function usePushTriggerReconcile() {
  const alerts = useAtomValue(alertsAtom);
  const alertsRef = useRef<Alert[]>(alerts);
  alertsRef.current = alerts;
  const workspaceReady = useAtomValue(workspaceReadyAtom);
  const registration = useAtomValue(pushRegistrationAtom);
  const externalSyncToken = useExternalSyncToken();
  const triggerAlert = useSetAtom(triggerAlertAtom);
  const token = registration?.token ?? externalSyncToken;
  const activeSnapshotKey = alerts
    .map((alert) =>
      [alert.id, alert.symbol, alert.condition, alert.price, alert.recurring].join(":"),
    )
    .sort()
    .join("|");

  useEffect(() => {
    if (!token || !workspaceReady) return;

    const reconcile = async () => {
      const triggers = await fetchPushTriggerStatus(token);
      for (const trigger of triggers) {
        const alert = alertsRef.current.find((item) => item.id === trigger.alertId);
        if (!alert) continue;
        if (
          alert.symbol !== trigger.symbol ||
          alert.condition !== trigger.condition ||
          alert.price !== trigger.price ||
          alert.recurring !== trigger.recurring
        ) {
          continue;
        }
        const knownTriggeredAt = alert.triggeredAt ? alert.triggeredAt * 1000 : 0;
        if (trigger.triggeredAt <= knownTriggeredAt) continue;
        triggerAlert(alert.id, trigger.triggerPrice, trigger.triggeredAt);
      }
    };

    void reconcile();
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(reconcile, POLL_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [activeSnapshotKey, token, triggerAlert, workspaceReady]);
}
