import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPushAlertSnapshot } from "../../src/services/notifications/pushAlertSnapshot";
import type { Alert } from "../../src/store/alertStore";

function alert(patch: Partial<Alert> = {}): Alert {
  return {
    id: "alert-1",
    symbol: " eurusd ",
    condition: "crossUp",
    price: 1.125,
    status: "active",
    enabled: true,
    locked: false,
    createdAt: 1_750_000_000,
    updatedAt: 1_750_000_001,
    armingRevision: 1,
    recurring: false,
    sound: true,
    browser: false,
    push: true,
    telegram: false,
    discord: false,
    ...patch,
  };
}

test("push snapshot normalizes every valid alert before replacement", () => {
  const result = buildPushAlertSnapshot([alert()]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.alerts[0]?.symbol, "EURUSD");
  assert.equal(result.alerts[0]?.updatedAt, 1_750_000_001_000);
});

test("one malformed alert rejects the whole push snapshot", () => {
  const result = buildPushAlertSnapshot([
    alert(),
    alert({ id: "broken-alert", price: Number.NaN }),
  ]);
  assert.deepEqual(result, {
    ok: false,
    error:
      "Alert broken-alert is invalid; the server snapshot was not changed.",
  });
});
