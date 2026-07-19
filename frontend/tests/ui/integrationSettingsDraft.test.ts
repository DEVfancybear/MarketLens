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
  mt5: { login: "server-login", server: "Broker-Demo", passwordConfigured: true },
  telegram: { chatId: "42", botTokenConfigured: true, enabled: true },
  discord: { webhookConfigured: true, enabled: true },
};

test("late integration loads preserve fields already edited by the user", () => {
  const current = createEmptyIntegrationDraft();
  current.mt5.login = "typed-login";
  current.mt5.server = "typed-server";
  const dirty = new Set<IntegrationDraftField>(["mt5.login", "mt5.server"]);

  const merged = mergeLoadedIntegrationSettings(current, loaded, dirty);

  assert.equal(merged.mt5.login, "typed-login");
  assert.equal(merged.mt5.server, "typed-server");
  assert.equal(merged.telegram.chatId, "42");
  assert.equal(merged.telegram.enabled, true);
  assert.equal(merged.discord.enabled, true);
});

test("loaded settings reset unsaved secrets without clearing active secret edits", () => {
  const current = createEmptyIntegrationDraft();
  current.mt5.password = "new-password";
  current.telegram.botToken = "stale-token";
  current.telegram.clearBotToken = true;

  const merged = mergeLoadedIntegrationSettings(
    current,
    loaded,
    new Set<IntegrationDraftField>(["mt5.password"]),
  );

  assert.equal(merged.mt5.password, "new-password");
  assert.equal(merged.telegram.botToken, "");
  assert.equal(merged.telegram.clearBotToken, false);
  assert.equal(merged.discord.webhookUrl, "");
});
