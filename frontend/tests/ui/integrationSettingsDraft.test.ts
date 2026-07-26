import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyIntegrationDraft,
  mergeLoadedIntegrationSettings,
  type IntegrationDraftField,
} from "../../src/components/settings/integrationSettingsDraft";
import type { IntegrationSettings } from "../../src/services/api/resources/integrationsApi";

const loaded: IntegrationSettings = {
  deliveryToken: "delivery-token",
  telegram: {
    chatId: "100",
    botTokenConfigured: true,
    enabled: true,
  },
  discord: {
    webhookConfigured: true,
    enabled: true,
  },
};

test("late hydration preserves edited notification fields", () => {
  const current = createEmptyIntegrationDraft();
  current.telegram.chatId = "typed-chat";
  current.discord.enabled = false;
  const dirty = new Set<IntegrationDraftField>([
    "telegram.chatId",
    "discord.enabled",
  ]);

  const merged = mergeLoadedIntegrationSettings(current, loaded, dirty);

  assert.equal(merged.telegram.chatId, "typed-chat");
  assert.equal(merged.telegram.enabled, true);
  assert.equal(merged.discord.enabled, false);
});

test("late hydration preserves an edited secret without exposing stored secrets", () => {
  const current = createEmptyIntegrationDraft();
  current.telegram.botToken = "new-token";
  current.telegram.clearBotToken = false;

  const merged = mergeLoadedIntegrationSettings(
    current,
    loaded,
    new Set<IntegrationDraftField>(["telegram.botToken"]),
  );

  assert.equal(merged.telegram.botToken, "new-token");
  assert.equal(merged.discord.webhookUrl, "");
});
