export type PushAlertCondition = "above" | "below" | "crossUp" | "crossDown";

export interface ServerPushAlert {
  id: string;
  symbol: string;
  condition: PushAlertCondition;
  price: number;
  note?: string;
  recurring: boolean;
  updatedAt: number;
  lastTriggeredAt?: number;
  triggerPrice?: number;
  push?: boolean;
  telegram?: boolean;
  discord?: boolean;
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
      oneTimeFired?: boolean;
      triggerPrice?: number;
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
  triggerPrice: number;
  triggeredAt: number;
}
