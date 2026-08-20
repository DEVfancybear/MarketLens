import assert from "node:assert/strict";
import test from "node:test";

import { createResizeScheduler } from "../../src/components/chart/chartResizeScheduler";

test("coalesces resize notifications and flushes the latest dimensions once", () => {
  const scheduled: Array<() => void> = [];
  const writes: Array<[number, number]> = [];
  const scheduler = createResizeScheduler(
    (width, height) => writes.push([width, height]),
    (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    () => undefined,
  );

  scheduler.schedule(800, 400);
  scheduler.schedule(801, 401);

  assert.equal(scheduled.length, 1);
  assert.deepEqual(writes, []);

  scheduled[0]!();

  assert.deepEqual(writes, [[801, 401]]);
});

test("cancels pending resize work without flushing", () => {
  const scheduled: Array<() => void> = [];
  const writes: Array<[number, number]> = [];
  const scheduler = createResizeScheduler(
    (width, height) => writes.push([width, height]),
    (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    () => undefined,
  );

  scheduler.schedule(800, 400);
  scheduler.cancel();
  scheduled[0]!();

  assert.deepEqual(writes, []);
});
