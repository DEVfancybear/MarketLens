"use client";

import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  alertsAtom,
  expireAlertAtom,
  triggerAlertAtom,
  type Alert,
} from "@/store/alertStore";
import { workspaceReadyAtom } from "@/store/authStore";
import { pushRegistrationAtom } from "@/store/notificationStore";
import { fetchPushAlertStatus } from "@/services/notifications/push";
import { useExternalSyncToken } from "@/hooks/useExternalSyncToken";
import { sanitizeTechnicalAlertEvidence } from "@/services/dynamicAlertTargets";

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
  const expireAlert = useSetAtom(expireAlertAtom);
  const token = registration?.token ?? externalSyncToken;
  const activeSnapshotKey = alerts
    .map((alert) =>
      [
        alert.id,
        alert.symbol,
        alert.condition,
        alert.price,
        alert.recurring,
        alert.armingRevision,
      ].join(":"),
    )
    .sort()
    .join("|");

  useEffect(() => {
    if (!token || !workspaceReady) return;

    const reconcile = async () => {
      const status = await fetchPushAlertStatus(token);
      for (const trigger of status.triggers) {
        const alert = alertsRef.current.find((item) => item.id === trigger.alertId);
        if (!alert) continue;
        if (
          alert.symbol !== trigger.symbol ||
          alert.condition !== trigger.condition ||
          alert.price !== trigger.price ||
          alert.recurring !== trigger.recurring ||
          (trigger.armingRevision !== undefined &&
            alert.armingRevision !== trigger.armingRevision)
        ) {
          continue;
        }
        const knownTriggeredAt = alert.triggeredAt ? alert.triggeredAt * 1000 : 0;
        if (trigger.triggeredAt <= knownTriggeredAt) continue;
        triggerAlert(
          alert.id,
          trigger.triggerPrice,
          trigger.triggeredAt,
          trigger.targetPrice,
          sanitizeTechnicalAlertEvidence(trigger.evidence),
        );
      }
      for (const expiration of status.expirations) {
        const alert = alertsRef.current.find((item) => item.id === expiration.alertId);
        if (
          !alert ||
          alert.symbol !== expiration.symbol ||
          alert.armingRevision !== expiration.armingRevision
        ) {
          continue;
        }
        expireAlert(alert.id, expiration.expiredAt);
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
  }, [activeSnapshotKey, expireAlert, token, triggerAlert, workspaceReady]);
}
