import { getJson, postJson, putJson } from "@/services/api/client";
import { MT5_VERIFICATION_REQUEST_TIMEOUT_MS } from "@/services/api/timeouts";

export { MT5_VERIFICATION_REQUEST_TIMEOUT_MS } from "@/services/api/timeouts";

export interface IntegrationSettings {
  deliveryToken: string;
  mt5: {
    login: string;
    server: string;
    passwordConfigured: boolean;
    verified: boolean;
    verifiedAt: string | null;
  };
  telegram: { chatId: string; botTokenConfigured: boolean; enabled: boolean };
  discord: { webhookConfigured: boolean; enabled: boolean };
}

export interface Mt5VerifiedAccount {
  login: string;
  server: string;
  name?: string;
  company?: string;
  currency?: string;
  leverage?: number;
  tradeAllowed: boolean;
}

export interface Mt5VerificationResult {
  ok: true;
  mt5: IntegrationSettings["mt5"];
  account: Mt5VerifiedAccount;
}

export interface IntegrationSettingsWrite {
  mt5: { login: string; server: string; password: string; clearPassword: boolean };
  telegram: { chatId: string; botToken: string; enabled: boolean; clearBotToken: boolean };
  discord: { webhookUrl: string; enabled: boolean; clearWebhook: boolean };
}

let pendingSettingsRequest: Promise<IntegrationSettings> | null = null;

/** Coalesce the global MT5 access hydration and a simultaneously opened dialog. */
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

export const verifyMt5Integration = () => {
  invalidateIntegrationSettingsRequest();
  return postJson<Mt5VerificationResult>(
    "settings/integrations/verify/mt5",
    undefined,
    {
      timeout: MT5_VERIFICATION_REQUEST_TIMEOUT_MS,
      retry: { limit: 0 },
    },
  );
};
export const testIntegration = (channel: "telegram" | "discord") => postJson<{ok:boolean;channel:string}>(`settings/integrations/test/${channel}`);
export const deliverIntegrationAlert = (body: unknown) => postJson<{ok:boolean;results:Array<{ok:boolean;channel:string;error?:string}>}>("settings/integrations/deliver", body);
