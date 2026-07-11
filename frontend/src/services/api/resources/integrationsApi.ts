import { getJson, postJson, putJson } from "@/services/api/client";

export interface IntegrationSettings {
  deliveryToken: string;
  mt5: { login: string; server: string; passwordConfigured: boolean };
  telegram: { chatId: string; botTokenConfigured: boolean; enabled: boolean };
  discord: { webhookConfigured: boolean; enabled: boolean };
}

export interface IntegrationSettingsWrite {
  mt5: { login: string; server: string; password: string; clearPassword: boolean };
  telegram: { chatId: string; botToken: string; enabled: boolean; clearBotToken: boolean };
  discord: { webhookUrl: string; enabled: boolean; clearWebhook: boolean };
}

export const getIntegrationSettings = () => getJson<IntegrationSettings>("settings/integrations");
export const saveIntegrationSettings = (body: IntegrationSettingsWrite) => putJson<IntegrationSettings>("settings/integrations", body);
export const testIntegration = (channel: "telegram" | "discord") => postJson<{ok:boolean;channel:string}>(`settings/integrations/test/${channel}`);
export const deliverIntegrationAlert = (body: unknown) => postJson<{ok:boolean;results:Array<{ok:boolean;channel:string;error?:string}>}>("settings/integrations/deliver", body);
