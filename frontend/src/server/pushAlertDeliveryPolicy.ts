import type {
  PendingPushAlertDelivery,
  PendingPushAlertTrigger,
  PushDeviceRecord,
  ServerPushAlert,
} from "@/types/pushAlerts";

export function createPendingPushAlertDelivery(
  eventId: string,
  device: Pick<
    PushDeviceRecord,
    "settingsPush" | "settingsTelegram" | "settingsDiscord"
  >,
  alert: ServerPushAlert,
  candidate: PendingPushAlertTrigger,
): PendingPushAlertDelivery | undefined {
  const delivery: PendingPushAlertDelivery = {
    eventId,
    alert: { ...alert },
    candidate,
    push: device.settingsPush && Boolean(alert.push),
    telegram: device.settingsTelegram && Boolean(alert.telegram),
    discord: device.settingsDiscord && Boolean(alert.discord),
  };
  return delivery.push || delivery.telegram || delivery.discord
    ? delivery
    : undefined;
}

/** One external attempt per canonical event/channel within an evaluator run. */
export function externalAlertDeliveryKey(
  eventId: string,
  channel: "telegram" | "discord",
): string {
  return `${eventId}:${channel}`;
}

export function shouldRetainPushAlertState(
  alertIsActive: boolean,
  state: { pendingDelivery?: PendingPushAlertDelivery },
): boolean {
  return alertIsActive || state.pendingDelivery !== undefined;
}
