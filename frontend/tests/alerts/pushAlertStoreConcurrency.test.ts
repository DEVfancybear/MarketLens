import assert from "node:assert/strict";
import { test } from "node:test";

import { alertArmingRevision } from "../../src/services/alertConditions";
import {
  mergeEvaluatorState,
  type EvaluatorStatePatch,
} from "../../src/server/pushAlertStateMerge";
import type {
  PendingPushAlertDelivery,
  PushDeviceRecord,
  ServerPushAlert,
} from "../../src/types/pushAlerts";

function alert(price = 1.1): ServerPushAlert {
  return {
    id: "alert-1",
    symbol: "EURUSD",
    condition: "crossUp",
    price,
    recurring: false,
    updatedAt: 1_750_000_000_000,
    armingRevision: 1,
    push: true,
  };
}

function signature(value: ServerPushAlert): string {
  return `${alertArmingRevision(
    value.condition,
    value.symbol,
    value.price,
    value.recurring,
    value.armingRevision,
  )}:legacy-fixed`;
}

function device(
  alerts: ServerPushAlert[],
  alertState: PushDeviceRecord["alertState"],
): PushDeviceRecord {
  return {
    token: "device-token",
    userId: "user-1",
    deliveryToken: "delivery-token",
    alerts,
    settingsPush: true,
    settingsTelegram: false,
    settingsDiscord: false,
    lastPrices: {},
    alertState,
    createdAt: 1,
    updatedAt: 1,
  };
}

function pendingDelivery(
  value: ServerPushAlert,
  eventId: string,
): PendingPushAlertDelivery {
  return {
    eventId,
    alert: value,
    candidate: {
      triggerPrice: value.price + 0.01,
      targetPrice: value.price,
      triggeredAt: 1_750_000_001_000,
      triggerEvidence: {
        current: {
          price: value.price + 0.01,
          timestamp: 1_750_000_001,
        },
      },
    },
    push: true,
    telegram: false,
    discord: false,
  };
}

test("stale evaluator state cannot overwrite an edited alert definition", () => {
  const oldAlert = alert(1.1);
  const currentAlert = alert(1.2);
  const currentSignature = signature(currentAlert);
  const staleSignature = signature(oldAlert);
  const existing = device([currentAlert], {
    [currentAlert.id]: {
      signature: currentSignature,
      lastEvaluatedAt: 2_000,
    },
  });

  const patch: EvaluatorStatePatch = {
    lastPrices: { EURUSD: 1.11 },
    alertState: {
      [oldAlert.id]: {
        signature: staleSignature,
        lastEvaluatedAt: 3_000,
      },
    },
    alertSignatures: { [oldAlert.id]: staleSignature },
  };

  const merged = mergeEvaluatorState(existing, patch);
  assert.equal(merged.alertState[currentAlert.id]?.signature, currentSignature);
  assert.equal(merged.alertState[currentAlert.id]?.lastEvaluatedAt, 2_000);
});

test("a canonical delivery retry survives removal of the active definition", () => {
  const value = alert();
  const alertSignature = signature(value);
  const delivery = pendingDelivery(value, "event-1");
  const patch: EvaluatorStatePatch = {
    lastPrices: {},
    alertState: {
      [value.id]: {
        signature: alertSignature,
        pendingDelivery: delivery,
        lastTriggeredAt: delivery.candidate.triggeredAt,
      },
    },
    alertSignatures: { [value.id]: alertSignature },
  };

  const merged = mergeEvaluatorState(device([], {}), patch);
  assert.equal(
    merged.alertState[value.id]?.pendingDelivery?.eventId,
    "event-1",
  );
});

test("a canonical delivery retry survives a concurrent alert edit", () => {
  const oldAlert = alert(1.1);
  const editedAlert = alert(1.2);
  const oldSignature = signature(oldAlert);
  const editedSignature = signature(editedAlert);
  const delivery = pendingDelivery(oldAlert, "event-1");
  const existing = device([editedAlert], {
    [editedAlert.id]: {
      signature: editedSignature,
      lastEvaluatedAt: 1_750_000_002_000,
    },
  });

  const merged = mergeEvaluatorState(existing, {
    lastPrices: {},
    alertState: {
      [oldAlert.id]: {
        signature: oldSignature,
        lastTriggeredAt: delivery.candidate.triggeredAt,
        pendingDelivery: delivery,
      },
    },
    alertSignatures: { [oldAlert.id]: oldSignature },
  });

  assert.equal(
    merged.alertState[oldAlert.id]?.pendingDelivery?.eventId,
    "event-1",
  );
  assert.equal(merged.alertState[oldAlert.id]?.signature, oldSignature);
});

test("same-event merge never reactivates an already delivered channel", () => {
  const value = alert();
  const alertSignature = signature(value);
  const completedPush = {
    ...pendingDelivery(value, "event-1"),
    push: false,
    telegram: true,
  };
  const staleFullDelivery = {
    ...completedPush,
    push: true,
  };
  const existing = device([value], {
    [value.id]: {
      signature: alertSignature,
      lastTriggeredAt: completedPush.candidate.triggeredAt,
      pendingDelivery: completedPush,
    },
  });

  const merged = mergeEvaluatorState(existing, {
    lastPrices: {},
    alertState: {
      [value.id]: {
        signature: alertSignature,
        lastTriggeredAt: staleFullDelivery.candidate.triggeredAt,
        pendingDelivery: staleFullDelivery,
      },
    },
    alertSignatures: { [value.id]: alertSignature },
  });
  assert.equal(merged.alertState[value.id]?.pendingDelivery?.push, false);
  assert.equal(merged.alertState[value.id]?.pendingDelivery?.telegram, true);
});

test("a successful delivery removes only the matching retained event", () => {
  const value = alert();
  const alertSignature = signature(value);
  const delivery = pendingDelivery(value, "event-1");
  const existing = device([], {
    [value.id]: {
      signature: alertSignature,
      lastTriggeredAt: delivery.candidate.triggeredAt,
      pendingDelivery: delivery,
    },
  });

  const matching = mergeEvaluatorState(existing, {
    lastPrices: {},
    alertState: {},
    alertSignatures: { [value.id]: alertSignature },
    removedAlertState: {
      [value.id]: {
        signature: alertSignature,
        eventId: "event-1",
        cursor: delivery.candidate.triggeredAt,
      },
    },
  });
  assert.equal(matching.alertState[value.id], undefined);

  const editedAlert = alert(1.2);
  const edited = mergeEvaluatorState(
    device([editedAlert], {
      [value.id]: {
        signature: alertSignature,
        lastTriggeredAt: delivery.candidate.triggeredAt,
        pendingDelivery: delivery,
      },
    }),
    {
      lastPrices: {},
      alertState: {},
      alertSignatures: { [value.id]: signature(editedAlert) },
      removedAlertState: {
        [value.id]: {
          signature: alertSignature,
          eventId: "event-1",
          cursor: delivery.candidate.triggeredAt,
        },
      },
    },
  );
  assert.equal(edited.alertState[value.id], undefined);

  const newerDelivery = pendingDelivery(value, "event-2");
  const concurrent = device([], {
    [value.id]: {
      signature: alertSignature,
      lastTriggeredAt: newerDelivery.candidate.triggeredAt,
      pendingDelivery: newerDelivery,
    },
  });
  const staleRemoval = mergeEvaluatorState(concurrent, {
    lastPrices: {},
    alertState: {},
    alertSignatures: { [value.id]: alertSignature },
    removedAlertState: {
      [value.id]: {
        signature: alertSignature,
        eventId: "event-1",
        cursor: delivery.candidate.triggeredAt,
      },
    },
  });
  assert.equal(
    staleRemoval.alertState[value.id]?.pendingDelivery?.eventId,
    "event-2",
  );
});

test("a removed alert cannot regain cursor-only state from a stale worker", () => {
  const value = alert();
  const alertSignature = signature(value);
  const merged = mergeEvaluatorState(device([], {}), {
    lastPrices: {},
    alertState: {
      [value.id]: {
        signature: alertSignature,
        lastEvaluatedAt: 1_750_000_002_000,
      },
    },
    alertSignatures: { [value.id]: alertSignature },
  });
  assert.equal(merged.alertState[value.id], undefined);
});
