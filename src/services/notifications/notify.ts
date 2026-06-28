/**
 * Alert notification dispatcher (Phase 2).
 *
 * Fans a triggered alert out to the enabled delivery channels. Channels are
 * intentionally decoupled so Phase 6 (Firebase Cloud Messaging / mobile push)
 * can be added as one more channel here without touching the engine or store:
 *
 *   in-app toast   → toastStore           (done)
 *   sound chime    → notifications/sound   (done)
 *   system notif   → notifications/browser (done)
 *   push (mobile)  → notifications/push    (Phase 6 — add a channel call below)
 *
 * Pure dispatch — no evaluation logic. The engine decides *when*; this decides
 * *how*.
 */
import { getDefaultStore } from "jotai";
import { pushToastAtom } from "@/store/toastStore";
import { logAtom } from "@/store/uiStore";
import { playAlertSound } from "./sound";
import { showBrowserNotification } from "./browser";
import {
  CONDITION_SYMBOL,
  type Alert,
  type AlertSettings,
} from "@/store/alertStore";

function format(
  alert: Alert,
  triggerPrice: number,
): { title: string; body: string } {
  const op = CONDITION_SYMBOL[alert.condition];
  return {
    title: `⏰ ${alert.symbol} alert`,
    body: `${alert.symbol} ${op} ${alert.price} — now ${triggerPrice}${alert.note ? ` · ${alert.note}` : ""}`,
  };
}

/**
 * Deliver a triggered alert across enabled channels. Per-alert flags
 * (`alert.sound` / `alert.browser`) gate sound + system push; the global
 * `settings.toast` gates the in-app toast.
 */
export function deliverAlert(
  alert: Alert,
  triggerPrice: number,
  settings: AlertSettings,
): void {
  const { title, body } = format(alert, triggerPrice);

  // Always log to the in-app event log for an audit trail.
  getDefaultStore().set(logAtom, "info", `Alert triggered: ${body}`);

  if (settings.toast) {
    getDefaultStore().set(pushToastAtom, {
      title,
      message: body,
      variant: "alert",
      duration: 8000,
    });
  }
  if (alert.sound && settings.sound) {
    playAlertSound();
  }
  if (alert.browser && settings.browser) {
    showBrowserNotification(title, body);
  }
}
