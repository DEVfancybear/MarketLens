/**
 * Alert notification dispatcher.
 *
 * All human-readable alert channels use the same Vietnamese message and the
 * same event timestamp rendered in the chart's selected time zone.
 * Host/platform receipt timestamps remain metadata and are not used as the
 * alert time.
 */
import { getDefaultStore } from "jotai";
import { pushToastAtom } from "@/store/toastStore";
import { logAtom } from "@/store/uiStore";
import { pushRegistrationAtom } from "@/store/notificationStore";
import { playAlertSound } from "./sound";
import { showBrowserNotification } from "./browser";
import { sendAlertPush } from "./push";
import { sendExternalAlert } from "./external";
import { type Alert, type AlertSettings } from "@/store/alertStore";
import { resolvedChartTimeZoneAtom } from "@/store/chartStore";
import { formatAlertNotificationMessage } from "./alertMessage";

function alertTriggeredAtMs(alert: Alert): number {
  return alert.triggeredAt !== undefined
    ? alert.triggeredAt * 1000
    : Date.now();
}

export function formatAlertNotification(
  alert: Alert,
  triggerPrice: number,
  triggeredAtMs = alertTriggeredAtMs(alert),
  timeZone = "UTC",
): { title: string; body: string } {
  const targetPrice = alert.evaluatedTargetPrice ?? alert.price;
  return formatAlertNotificationMessage({
    symbol: alert.symbol,
    condition: alert.condition,
    technicalTarget: alert.technicalTarget,
    targetPrice,
    triggerPrice,
    triggeredAt: triggeredAtMs,
    timeZone,
    note: alert.note,
    source: "browser-open",
  });
}

/** Deliver one accepted trigger across all enabled local and remote channels. */
export function deliverAlert(
  alert: Alert,
  triggerPrice: number,
  settings: AlertSettings,
): void {
  const triggeredAtMs = alertTriggeredAtMs(alert);
  const timeZone = getDefaultStore().get(resolvedChartTimeZoneAtom);
  const { title, body } = formatAlertNotification(
    alert,
    triggerPrice,
    triggeredAtMs,
    timeZone,
  );
  const targetPrice = alert.evaluatedTargetPrice ?? alert.price;

  getDefaultStore().set(logAtom, "info", `Đã kích hoạt cảnh báo: ${body}`);

  if (settings.toast) {
    getDefaultStore().set(pushToastAtom, {
      title,
      message: body,
      variant: "alert",
      duration: 8000,
    });
  }
  if (alert.sound && settings.sound) playAlertSound();
  if (alert.browser && settings.browser) showBrowserNotification(title, body);

  if (alert.push && settings.push) {
    const registration = getDefaultStore().get(pushRegistrationAtom);
    if (registration?.token) {
      void sendAlertPush({
        token: registration.token,
        title,
        body,
        alert,
        triggerPrice,
        targetPrice,
      }).then((result) => {
        if (!result.ok) {
          getDefaultStore().set(
            logAtom,
            "warn",
            `Gửi thông báo đẩy thất bại: ${result.error}`,
          );
        }
      });
    }
  }

  if ((alert.telegram && settings.telegram) || (alert.discord && settings.discord)) {
    void sendExternalAlert({
      alert,
      triggerPrice,
      targetPrice,
      triggeredAt: triggeredAtMs,
      timeZone,
      channels: {
        telegram: alert.telegram && settings.telegram,
        discord: alert.discord && settings.discord,
      },
    }).then((result) => {
      if (!result.ok) {
        getDefaultStore().set(
          logAtom,
          "warn",
          `Gửi thông báo Telegram/Discord thất bại: ${result.error}`,
        );
      }
    });
  }
}
