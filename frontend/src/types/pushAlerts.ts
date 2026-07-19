export type PushAlertCondition = "above" | "below" | "crossUp" | "crossDown";
import type {
  TechnicalAlertEvidence,
  TechnicalAlertTarget,
} from "./technicalAlerts";

export interface ServerPushAlert {
  id: string;
  symbol: string;
  condition: PushAlertCondition;
  price: number;
  note?: string;
  recurring: boolean;
  updatedAt: number;
  armingRevision: number;
  lastTriggeredAt?: number;
  triggerPrice?: number;
  targetPrice?: number;
  triggerEvidence?: TechnicalAlertEvidence;
  push?: boolean;
  telegram?: boolean;
  discord?: boolean;
  technicalTarget?: TechnicalAlertTarget;
}

export interface PushAlertSyncRequest {
  token: string;
  deliveryToken?: string;
  /** Resolved IANA chart zone used for closed-browser notification rendering. */
  notificationTimeZone?: string;
  settingsPush: boolean;
  settingsTelegram?: boolean;
  settingsDiscord?: boolean;
  alerts: ServerPushAlert[];
}

export interface PushWorkerTriggerRequest {
  deliveryToken: string;
  alertId: string;
  triggerPrice: number;
  targetPrice?: number;
  previous?: TechnicalAlertEvidence["previous"];
  current: TechnicalAlertEvidence["current"];
  armingRevision: number;
}

export interface PushWorkerTriggerResponse {
  ok: true;
  alreadyTriggered: boolean;
  event: { id: string };
}

export interface PendingPushAlertTrigger {
  triggerPrice: number;
  targetPrice: number;
  /** Notification/worker timestamp in epoch milliseconds. */
  triggeredAt: number;
  /** Canonical backend evidence remains UTC epoch seconds. */
  triggerEvidence: TechnicalAlertEvidence;
}

export interface PendingPushAlertDelivery {
  eventId: string;
  /** Frozen payload retained even after one-time alert sync removes the active definition. */
  alert: ServerPushAlert;
  candidate: PendingPushAlertTrigger;
  /** Frozen display zone for retries of this exact event. */
  notificationTimeZone?: string;
  push: boolean;
  telegram: boolean;
  discord: boolean;
}

export interface PushDeviceRecord {
  token: string;
  /** Firebase UID that owns this token; optional only for legacy records. */
  userId?: string;
  deliveryToken?: string;
  /** Resolved IANA chart zone. Older records safely fall back to UTC. */
  notificationTimeZone?: string;
  alerts: ServerPushAlert[];
  settingsPush: boolean;
  settingsTelegram: boolean;
  settingsDiscord: boolean;
  lastPrices: Record<string, number>;
  alertState: Record<
    string,
    {
      signature: string;
      lastTriggeredAt?: number;
      lastEvaluatedAt?: number;
      /** Last broker/chart epoch, separate from the receive-time replay cursor. */
      lastMarketTimestamp?: number;
      oneTimeFired?: boolean;
      triggerPrice?: number;
      targetPrice?: number;
      triggerEvidence?: TechnicalAlertEvidence;
      /** Durable retry candidate when PostgreSQL acknowledgement is unavailable. */
      pendingTrigger?: PendingPushAlertTrigger;
      /** Per-destination at-least-once delivery work after canonical commit. */
      pendingDelivery?: PendingPushAlertDelivery;
      /** Permanent canonical rejection for this exact alert signature. */
      canonicalRejectedAt?: number;
      canonicalRejectedReason?: string;
      expiredAt?: number;
    }
  >;
  createdAt: number;
  updatedAt: number;
}

export interface PushAlertDb {
  version: 1;
  devices: Record<string, PushDeviceRecord>;
}

/** A server-confirmed closed-browser trigger reconciled after workspace bootstrap. */
export interface PushAlertTriggerStatus {
  alertId: string;
  symbol: string;
  condition: PushAlertCondition;
  price: number;
  recurring: boolean;
  armingRevision: number;
  triggerPrice: number;
  targetPrice?: number;
  triggeredAt: number;
  evidence?: TechnicalAlertEvidence;
}

export interface PushAlertExpirationStatus {
  alertId: string;
  symbol: string;
  armingRevision: number;
  expiredAt: number;
}

export interface PushAlertReconcileStatus {
  triggers: PushAlertTriggerStatus[];
  expirations: PushAlertExpirationStatus[];
}
