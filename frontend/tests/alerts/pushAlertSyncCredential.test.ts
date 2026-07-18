import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canSyncClosedBrowserAlerts,
  resolveStoredDeliveryToken,
  workerCredentialRetryDelay,
} from "../../src/services/notifications/pushSyncPolicy";

test("closed-browser alert sync waits for a signed backend credential", () => {
  assert.equal(canSyncClosedBrowserAlerts(true, { status: "idle" }), false);
  assert.equal(canSyncClosedBrowserAlerts(true, { status: "loading" }), false);
  assert.equal(canSyncClosedBrowserAlerts(true, { status: "failed" }), false);
  assert.equal(
    canSyncClosedBrowserAlerts(false, { status: "ready", token: "signed" }),
    false,
  );
  assert.equal(
    canSyncClosedBrowserAlerts(true, { status: "ready", token: "signed" }),
    true,
  );
});

test("startup sync cannot erase an existing signed worker credential", () => {
  assert.equal(
    resolveStoredDeliveryToken(undefined, "existing-signed-token"),
    "existing-signed-token",
  );
  assert.equal(
    resolveStoredDeliveryToken("   ", "existing-signed-token"),
    "existing-signed-token",
  );
  assert.equal(
    resolveStoredDeliveryToken(" refreshed-token ", "existing-signed-token"),
    "refreshed-token",
  );
});

test("signed credential retries back off quickly and cap at one minute", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 20].map(workerCredentialRetryDelay),
    [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000],
  );
});

test("signed credential retry delay normalizes invalid attempt counters", () => {
  assert.equal(workerCredentialRetryDelay(-3), 1_000);
  assert.equal(workerCredentialRetryDelay(1.9), 2_000);
  assert.equal(workerCredentialRetryDelay(Number.NaN), 1_000);
  assert.equal(workerCredentialRetryDelay(Number.POSITIVE_INFINITY), 1_000);
});
