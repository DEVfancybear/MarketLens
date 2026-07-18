import assert from "node:assert/strict";
import { test } from "node:test";

import { persistBeforeNotification } from "../../src/server/pushAlertLifecycle";

test("notification channels run only after canonical persistence", async () => {
  const order: string[] = [];
  const result = await persistBeforeNotification(
    async () => {
      order.push("persist");
      return { alreadyTriggered: false, eventId: "event-1" };
    },
    async () => {
      order.push("notify");
      return "delivered";
    },
  );

  assert.deepEqual(order, ["persist", "notify"]);
  assert.deepEqual(result, {
    committed: true,
    canonical: { alreadyTriggered: false, eventId: "event-1" },
    notification: "delivered",
  });
});

test("transient persistence failure blocks notification and succeeds on exact retry", async () => {
  let persistenceCalls = 0;
  let notificationCalls = 0;
  const persist = async () => {
    persistenceCalls += 1;
    if (persistenceCalls === 1) throw new Error("backend unavailable");
    return { alreadyTriggered: false, eventId: "event-2" };
  };
  const notify = async () => {
    notificationCalls += 1;
    return "sent";
  };
  const first = await persistBeforeNotification(
    persist,
    notify,
  );

  assert.equal(notificationCalls, 0);
  assert.deepEqual(first, {
    committed: false,
    persistenceError: "backend unavailable",
    retryable: true,
  });

  const second = await persistBeforeNotification(
    persist,
    notify,
  );
  assert.equal(persistenceCalls, 2);
  assert.equal(notificationCalls, 1);
  assert.deepEqual(second, {
    committed: true,
    canonical: { alreadyTriggered: false, eventId: "event-2" },
    notification: "sent",
  });
});

test("idempotent acknowledgement still drains pending at-least-once delivery", async () => {
  let notificationCalls = 0;
  const result = await persistBeforeNotification(
    async () => ({ alreadyTriggered: true, eventId: "event-3" }),
    async () => {
      notificationCalls += 1;
      return "sent-after-ambiguous-commit";
    },
  );

  assert.equal(notificationCalls, 1);
  assert.deepEqual(result, {
    committed: true,
    canonical: { alreadyTriggered: true, eventId: "event-3" },
    notification: "sent-after-ambiguous-commit",
  });
});

test("delivery failure cannot reactivate an already committed one-time trigger", async () => {
  const result = await persistBeforeNotification(
    async () => ({ alreadyTriggered: false, eventId: "event-4" }),
    async () => {
      throw new Error("Discord unavailable");
    },
  );

  assert.deepEqual(result, {
    committed: true,
    canonical: { alreadyTriggered: false, eventId: "event-4" },
    notificationError: "Discord unavailable",
  });
});
