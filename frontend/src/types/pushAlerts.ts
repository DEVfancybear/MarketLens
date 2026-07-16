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
  settingsPush: boolean;
  settingsTelegram?: boolean;
  settingsDiscord?: boolean;
  alerts: ServerPushAlert[];
}

export interface PushDeviceRecord {
  token: string;
  deliveryToken?: string;
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
