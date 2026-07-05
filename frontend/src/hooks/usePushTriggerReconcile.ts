"use client";
/**
 * Reconciles server-confirmed closed-browser triggers back into the local
 * alert store. `useAlertEngine`'s own reopen recovery rescans the loaded
 * candle series, but that scan is bounded by whatever chart timeframe is
 * currently selected — a brief crossing shortly after arming can fall inside
 * a single coarse (e.g. 15m/1H) candle that started before the alert existed,
 * making it invisible to the client even though the server (1-minute
 * resolution) already caught it and sent a notification. This polls the
 * server's per-alert trigger record and, when it's newer than what we know
 * locally, applies it via the same `triggerAlert` action the live engine
 * uses (without re-delivering notifications — those already went out).
 */
import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { alertsAtom, triggerAlertAtom, type Alert } from "@/store/alertStore";
import { pushRegistrationAtom } from "@/store/notificationStore";
import { fetchPushTriggerStatus } from "@/services/notifications/push";
import { useExternalSyncToken } from "@/hooks/useExternalSyncToken";

const POLL_INTERVAL_MS = 60_000;

export function usePushTriggerReconcile() {
  const alerts = useAtomValue(alertsAtom);
  const alertsRef = useRef<Alert[]>(alerts);
  alertsRef.current = alerts;
  const registration = useAtomValue(pushRegistrationAtom);
  const externalSyncToken = useExternalSyncToken();
  const triggerAlert = useSetAtom(triggerAlertAtom);
  const token = registration?.token ?? externalSyncToken;

  useEffect(() => {
    if (!token) return;

    const reconcile = async () => {
      const triggers = await fetchPushTriggerStatus(token);
      if (triggers.length === 0) return;
      for (const trigger of triggers) {
        const alert = alertsRef.current.find((a) => a.id === trigger.alertId);
        if (!alert) continue;
        if (
          alert.symbol !== trigger.symbol ||
          alert.condition !== trigger.condition ||
          alert.price !== trigger.price ||
          alert.recurring !== trigger.recurring
        ) {
          continue; // alert was edited since — stale server record, skip.
        }
        const knownTriggeredAt = alert.triggeredAt ? alert.triggeredAt * 1000 : 0;
        if (trigger.triggeredAt <= knownTriggeredAt) continue;
        triggerAlert(alert.id, trigger.triggerPrice);
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
  }, [token, triggerAlert]);
}
