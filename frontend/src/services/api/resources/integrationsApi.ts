import { getJson, postJson, putJson } from "@/services/api/client";

export interface IntegrationSettings {
  deliveryToken: string;
  telegram: { chatId: string; botTokenConfigured: boolean; enabled: boolean };
  discord: { webhookConfigured: boolean; enabled: boolean };
}

export interface IntegrationSettingsWrite {
  telegram: { chatId: string; botToken: string; enabled: boolean; clearBotToken: boolean };
  discord: { webhookUrl: string; enabled: boolean; clearWebhook: boolean };
}

let pendingSettingsRequest: Promise<IntegrationSettings> | null = null;

/** Coalesce concurrent notification integration settings requests. */
export function getIntegrationSettings(): Promise<IntegrationSettings> {
  if (pendingSettingsRequest) return pendingSettingsRequest;
  const request = getJson<IntegrationSettings>("settings/integrations");
  pendingSettingsRequest = request;
  const clearPending = () => {
    if (pendingSettingsRequest === request) pendingSettingsRequest = null;
  };
  void request.then(clearPending, clearPending);
  return request;
}

/** Prevent an in-flight request from being reused after an auth identity change. */
export function invalidateIntegrationSettingsRequest(): void {
  pendingSettingsRequest = null;
}

export const saveIntegrationSettings = (body: IntegrationSettingsWrite) => {
  invalidateIntegrationSettingsRequest();
  return putJson<IntegrationSettings>("settings/integrations", body);
};

export const testIntegration = (channel: "telegram" | "discord") => postJson<{ok:boolean;channel:string}>(`settings/integrations/test/${channel}`);
export const deliverIntegrationAlert = (body: unknown) => postJson<{ok:boolean;results:Array<{ok:boolean;channel:string;error?:string}>}>("settings/integrations/deliver", body);
