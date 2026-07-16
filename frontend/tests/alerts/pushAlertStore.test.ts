import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizePushAlertForStorage } from "../../src/services/pushAlertSanitizer";
import type { ServerPushAlert } from "../../src/types/pushAlerts";

function alert(patch: Partial<ServerPushAlert> = {}): ServerPushAlert {
  return {
    id: "alert-1",
    symbol: "EURUSD",
    condition: "crossUp",
    price: 1.125,
    recurring: false,
    updatedAt: 1_750_000_000_000,
    armingRevision: 1,
    ...patch,
  };
}

test("push storage rejects malformed technical targets instead of degrading to fixed price", () => {
  const malformed = alert({
    technicalTarget: {
      version: 1,
      kind: "dynamic-line",
      a: { time: 1_750_000_000, price: 1.12 },
      b: { time: 1_750_000_000, price: 1.13 },
      domain: "segment",
      interpolation: "linear",
    },
  });
  assert.equal(sanitizePushAlertForStorage(malformed), null);

  const legacy = sanitizePushAlertForStorage(alert());
  assert.ok(legacy);
  assert.equal(legacy.technicalTarget, undefined);
});

test("push storage preserves canonical technical geometry", () => {
  const stored = sanitizePushAlertForStorage(alert({
    technicalTarget: {
      version: 1,
      kind: "dynamic-line",
      a: { time: 1_750_000_000, price: 1.12 },
      b: { time: 1_750_003_600, price: 1.13 },
      domain: "ray",
      interpolation: "linear",
    },
  }));
  assert.equal(stored?.technicalTarget?.kind, "dynamic-line");
});

test("push storage preserves stable arming revision and normalized evidence", () => {
  const stored = sanitizePushAlertForStorage(alert({
    armingRevision: 7,
    triggerEvidence: {
      previous: { price: 1.12, timestamp: 1_750_000_000_000 },
      current: { price: 1.13, timestamp: 1_750_000_001_000 },
    },
  }));
  assert.equal(stored?.armingRevision, 7);
  assert.deepEqual(stored?.triggerEvidence, {
    previous: { price: 1.12, timestamp: 1_750_000_000 },
    current: { price: 1.13, timestamp: 1_750_000_001 },
  });
});
