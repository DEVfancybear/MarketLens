export type PushAlertCondition = "above" | "below" | "crossUp" | "crossDown";

export interface ServerPushAlert {
  id: string;
  symbol: string;
  condition: PushAlertCondition;
  price: number;
  note?: string;
  recurring: boolean;
  updatedAt: number;
}

export interface PushAlertSyncRequest {
  token: string;
  settingsPush: boolean;
  alerts: ServerPushAlert[];
}

export interface PushDeviceRecord {
  token: string;
  alerts: ServerPushAlert[];
  settingsPush: boolean;
  lastPrices: Record<string, number>;
  alertState: Record<
    string,
    {
      signature: string;
      lastTriggeredAt?: number;
      oneTimeFired?: boolean;
    }
  >;
  createdAt: number;
  updatedAt: number;
}

export interface PushAlertDb {
  version: 1;
  devices: Record<string, PushDeviceRecord>;
}
