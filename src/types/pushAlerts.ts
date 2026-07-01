export type PushAlertCondition = "above" | "below" | "crossUp" | "crossDown";

export interface ServerPushAlert {
  id: string;
  symbol: string;
  condition: PushAlertCondition;
  price: number;
  note?: string;
  recurring: boolean;
  updatedAt: number;
  push?: boolean;
  telegram?: boolean;
  discord?: boolean;
}

export interface PushAlertSyncRequest {
  token: string;
  settingsPush: boolean;
  settingsTelegram?: boolean;
  settingsDiscord?: boolean;
  alerts: ServerPushAlert[];
}

export interface PushDeviceRecord {
  token: string;
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

/**
 * A server-confirmed trigger for an alert that was synced for closed-browser
 * evaluation. Lets the client reconcile its own local Active/Triggered state
 * when a crossing was too brief for the client's own (chart-timeframe-bound)
 * candle scan to see, but the server (1-minute resolution) already caught it
 * and delivered a notification.
 */
export interface PushAlertTriggerStatus {
  alertId: string;
  symbol: string;
  condition: PushAlertCondition;
  price: number;
  recurring: boolean;
  triggerPrice: number;
  triggeredAt: number;
}
