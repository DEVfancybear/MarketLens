import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";

import {
  BrowserAlertTriggerQueue,
  type BrowserAlertTriggerCandidate,
} from "../../src/services/notifications/browserAlertTriggerQueue";

const candidate: BrowserAlertTriggerCandidate = {
  alertId: "trendline-1",
  revision: "crossDown:BTCUSD:7:dynamic-line",
  triggerPrice: 63_965.72,
  targetPrice: 63_966.305,
  evidence: {
    previous: { price: 63_967, timestamp: 1_752_836_820 },
    current: { price: 63_965.72, timestamp: 1_752_836_830.125 },
  },
};

test("browser trigger retries the exact crossing after a transient persistence failure", async () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  let attempts = 0;
  let notifications = 0;
  const queue = new BrowserAlertTriggerQueue<string>({
    isCurrent: () => true,
    attempt: async () => {
      attempts += 1;
      return attempts === 1
        ? { status: "retryable" }
        : {
            status: "committed",
            value: "fired",
          };
    },
    notify: () => {
      notifications += 1;
    },
    schedule: (callback, delay) => {
      scheduled.push({ callback, delay });
      return {} as ReturnType<typeof setTimeout>;
    },
    cancel: () => undefined,
  });

  queue.enqueue(candidate);
  await setImmediate();
  assert.equal(attempts, 1);
  assert.equal(notifications, 0);
  assert.equal(queue.pendingCount(), 1);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.delay, 2_000);

  scheduled.shift()?.callback();
  await setImmediate();
  assert.equal(attempts, 2);
  assert.equal(notifications, 1);
  assert.equal(queue.pendingCount(), 0);
  queue.dispose();
});

test("ambiguous commit retry still makes one notification attempt in this browser queue", async () => {
  let notifications = 0;
  const queue = new BrowserAlertTriggerQueue<string>({
    isCurrent: () => true,
    attempt: async () => ({
      status: "committed",
      value: "already-fired",
    }),
    notify: () => {
      notifications += 1;
    },
  });

  queue.enqueue(candidate);
  await setImmediate();
  assert.equal(queue.pendingCount(), 0);
  assert.equal(notifications, 1);
  queue.dispose();
});

test("permanent rejection or edited revision discards the pending crossing", async () => {
  const scheduled: Array<() => void> = [];
  let current = true;
  let attempts = 0;
  const queue = new BrowserAlertTriggerQueue<string>({
    isCurrent: () => current,
    attempt: async () => {
      attempts += 1;
      return { status: "retryable" };
    },
    notify: () => undefined,
    schedule: (callback) => {
      scheduled.push(callback);
      return {} as ReturnType<typeof setTimeout>;
    },
    cancel: () => undefined,
  });

  queue.enqueue(candidate);
  await setImmediate();
  current = false;
  scheduled.shift()?.();
  await setImmediate();
  assert.equal(attempts, 1);
  assert.equal(queue.pendingCount(), 0);

  const rejected = new BrowserAlertTriggerQueue<string>({
    isCurrent: () => true,
    attempt: async () => ({ status: "discarded" }),
    notify: () => undefined,
  });
  rejected.enqueue(candidate);
  await setImmediate();
  assert.equal(rejected.pendingCount(), 0);
  queue.dispose();
  rejected.dispose();
});

test("a trigger committed before a queued edit still delivers its frozen snapshot", async () => {
  let current = true;
  let resolveAttempt: ((value: {
    status: "committed";
    value: string;
  }) => void) | undefined;
  const attempt = new Promise<{
    status: "committed";
    value: string;
  }>((resolve) => {
    resolveAttempt = resolve;
  });
  const notifications: string[] = [];
  const queue = new BrowserAlertTriggerQueue<string>({
    isCurrent: () => current,
    attempt: async () => attempt,
    notify: (value) => notifications.push(value),
  });

  queue.enqueue(candidate);
  await setImmediate();
  current = false;
  resolveAttempt?.({ status: "committed", value: "pre-edit-alert" });
  await setImmediate();

  assert.deepEqual(notifications, ["pre-edit-alert"]);
  assert.equal(queue.pendingCount(), 0);
  queue.dispose();
});
