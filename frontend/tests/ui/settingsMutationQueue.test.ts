import assert from "node:assert/strict";
import { test } from "node:test";

import { createSettingsMutationQueue } from "../../src/services/api/settingsMutationQueue";
import type { SettingsPatch } from "../../src/services/api/resources/settingsApi";

test("settings queue coalesces rapid section changes into the latest patch", async () => {
  const writes: SettingsPatch[] = [];
  const queue = createSettingsMutationQueue("ui", 60_000, async (patch) => {
    writes.push(patch);
  });

  queue.enqueue({ theme: "dark", panels: { right: 300 } });
  queue.enqueue({ theme: "light", gridVisible: false });
  await queue.flush();

  assert.deepEqual(writes, [
    {
      ui: {
        theme: "light",
        panels: { right: 300 },
        gridVisible: false,
      },
    },
  ]);
});

test("settings queue serializes batches so older writes cannot finish last", async () => {
  const writes: SettingsPatch[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const queue = createSettingsMutationQueue("smc", 60_000, async (patch) => {
    writes.push(patch);
    if (writes.length === 1) await firstPending;
  });

  queue.enqueue({ structure: true });
  const firstFlush = queue.flush();
  await Promise.resolve();

  queue.enqueue({ structure: false });
  const secondFlush = queue.flush();
  await Promise.resolve();
  assert.equal(writes.length, 1);

  releaseFirst?.();
  await Promise.all([firstFlush, secondFlush]);
  assert.deepEqual(writes, [
    { smc: { structure: true } },
    { smc: { structure: false } },
  ]);
});

test("settings queue can cancel a pending logout-era write", async () => {
  const writes: SettingsPatch[] = [];
  const queue = createSettingsMutationQueue("chart", 60_000, async (patch) => {
    writes.push(patch);
  });

  queue.enqueue({ timeZone: "UTC" });
  queue.cancelPending();
  await queue.flush();

  assert.deepEqual(writes, []);
});

test("settings queue skips a serialized batch after the user session resets", async () => {
  const writes: SettingsPatch[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstPending = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const queue = createSettingsMutationQueue("chart", 60_000, async (patch) => {
    writes.push(patch);
    if (writes.length === 1) await firstPending;
  });

  queue.enqueue({ timeZone: "UTC" });
  const firstFlush = queue.flush();
  await Promise.resolve();
  await Promise.resolve();

  queue.enqueue({ timeZone: "Asia/Ho_Chi_Minh" });
  const secondFlush = queue.flush();
  queue.cancelPending();
  releaseFirst?.();
  await Promise.all([firstFlush, secondFlush]);

  assert.deepEqual(writes, [{ chart: { timeZone: "UTC" } }]);
});
