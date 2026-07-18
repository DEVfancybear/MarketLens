import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPendingPushAlertDelivery,
  externalAlertDeliveryKey,
  shouldRetainPushAlertState,
} from "../../src/server/pushAlertDeliveryPolicy";
import type {
  PendingPushAlertTrigger,
  ServerPushAlert,
} from "../../src/types/pushAlerts";

const alert: ServerPushAlert = {
  id: "trendline-alert",
  symbol: "BTCUSD",
  condition: "crossDown",
  price: 63_966.305,
  recurring: false,
  updatedAt: 1_752_836_800_000,
  armingRevision: 7,
  push: true,
  telegram: true,
  discord: true,
};

const candidate: PendingPushAlertTrigger = {
  triggerPrice: 63_965.72,
  targetPrice: 63_966.305,
  triggeredAt: 1_752_836_830_125,
  triggerEvidence: {
    previous: { price: 63_967, timestamp: 1_752_836_820 },
    current: { price: 63_965.72, timestamp: 1_752_836_830.125 },
  },
};

test("delivery work is retained per device channel after canonical commit", () => {
  const delivery = createPendingPushAlertDelivery(
    "canonical-event-1",
    {
      settingsPush: true,
      settingsTelegram: true,
      settingsDiscord: false,
    },
    alert,
    candidate,
  );

  assert.deepEqual(delivery, {
    eventId: "canonical-event-1",
    alert,
    candidate,
    push: true,
    telegram: true,
    discord: false,
  });
  assert.notEqual(delivery?.alert, alert);
});

test("external grouping is per canonical event and channel, not per device", () => {
  assert.equal(
    externalAlertDeliveryKey("event-1", "telegram"),
    externalAlertDeliveryKey("event-1", "telegram"),
  );
  assert.notEqual(
    externalAlertDeliveryKey("event-1", "telegram"),
    externalAlertDeliveryKey("event-1", "discord"),
  );
  assert.notEqual(
    externalAlertDeliveryKey("event-1", "telegram"),
    externalAlertDeliveryKey("event-2", "telegram"),
  );
});

test("no delivery record is created when every requested channel is disabled", () => {
  assert.equal(
    createPendingPushAlertDelivery(
      "event-none",
      {
        settingsPush: false,
        settingsTelegram: false,
        settingsDiscord: false,
      },
      alert,
      candidate,
    ),
    undefined,
  );
});

test("browser sync cannot prune failed delivery after one-time alert leaves active list", () => {
  const pendingDelivery = createPendingPushAlertDelivery(
    "event-retained",
    {
      settingsPush: true,
      settingsTelegram: false,
      settingsDiscord: false,
    },
    alert,
    candidate,
  );
  assert.ok(pendingDelivery);
  assert.equal(
    shouldRetainPushAlertState(false, { pendingDelivery }),
    true,
  );
  assert.equal(shouldRetainPushAlertState(false, {}), false);
  assert.equal(shouldRetainPushAlertState(true, {}), true);
});
