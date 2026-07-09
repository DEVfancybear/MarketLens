import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canUsePrivatePineWorkspace,
  fallbackBottomTabForAuth,
  visibleBottomPanelTabs,
  visibleIndicatorBrowserTabs,
} from "../../src/services/privateWorkspaceAccess";
import type { AuthStatus } from "../../src/store/authStore";
import type { BottomTab } from "../../src/store/uiStore";

const bottomTabs: { key: BottomTab; label: string }[] = [
  { key: "replay", label: "Replay" },
  { key: "trade", label: "Trade" },
  { key: "journal", label: "Journal" },
  { key: "analytics", label: "Analytics" },
  { key: "pine", label: "Pine Editor" },
  { key: "logs", label: "Logs" },
];

test("private Pine workspace is available only after authentication", () => {
  const blocked: AuthStatus[] = ["loading", "anonymous", "authenticating"];

  for (const status of blocked) {
    assert.equal(canUsePrivatePineWorkspace(status), false);
    assert.deepEqual(visibleIndicatorBrowserTabs(status), ["store"]);
  }

  assert.equal(canUsePrivatePineWorkspace("authed"), true);
  assert.deepEqual(visibleIndicatorBrowserTabs("authed"), [
    "favorites",
    "myScripts",
    "store",
  ]);
});

test("bottom panel hides private workspace tabs for signed-out users", () => {
  assert.deepEqual(
    visibleBottomPanelTabs(bottomTabs, "anonymous").map((tab) => tab.key),
    ["replay"],
  );
  assert.deepEqual(
    visibleBottomPanelTabs(bottomTabs, "authed").map((tab) => tab.key),
    ["replay", "trade", "journal", "analytics", "pine", "logs"],
  );
});

test("signed-out users are moved away from private bottom panel tabs", () => {
  assert.equal(fallbackBottomTabForAuth("pine", "anonymous"), "replay");
  assert.equal(fallbackBottomTabForAuth("trade", "anonymous"), "replay");
  assert.equal(fallbackBottomTabForAuth("journal", "anonymous"), "replay");
  assert.equal(fallbackBottomTabForAuth("analytics", "anonymous"), "replay");
  assert.equal(fallbackBottomTabForAuth("logs", "anonymous"), "replay");
  assert.equal(fallbackBottomTabForAuth("pine", "loading"), "replay");
  assert.equal(fallbackBottomTabForAuth("replay", "anonymous"), "replay");
  assert.equal(fallbackBottomTabForAuth("pine", "authed"), "pine");
});
