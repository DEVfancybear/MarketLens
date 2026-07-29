import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LatestPerScopeScheduler,
  ScopedLruCache,
} from "../../src/services/indicatorRuntimeScheduler";

interface ScheduledTask {
  id: string;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("runtime scheduler bounds concurrency and keeps only the latest task per scope", async () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  let active = 0;
  let peakActive = 0;
  const scheduler = new LatestPerScopeScheduler<ScheduledTask>({
    maxConcurrent: 2,
    run: async (task) => {
      started.push(task.id);
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise<void>((resolve) => releases.set(task.id, resolve));
      active -= 1;
    },
  });

  scheduler.enqueue("scope-a", { id: "a-1" });
  await flushMicrotasks();
  assert.deepEqual(started, ["a-1"]);

  assert.equal(scheduler.enqueue("scope-a", { id: "a-2" }), undefined);
  assert.deepEqual(
    scheduler.enqueue("scope-a", { id: "a-3" }),
    { id: "a-2" },
  );
  scheduler.enqueue("scope-b", { id: "b-1" });
  scheduler.enqueue("scope-c", { id: "c-1" });
  await flushMicrotasks();

  assert.equal(peakActive, 2);
  assert.equal(started.includes("a-2"), false);
  assert.deepEqual(started, ["a-1", "b-1"]);

  releases.get("a-1")?.();
  await flushMicrotasks();
  assert.equal(started.includes("a-3"), true);
  assert.equal(started.includes("a-2"), false);
  assert.equal(peakActive, 2);

  releases.get("b-1")?.();
  releases.get("a-3")?.();
  await flushMicrotasks();
  assert.equal(started.includes("c-1"), true);
  releases.get("c-1")?.();
  await flushMicrotasks();
});

test("scoped runtime cache evicts superseded live snapshots", () => {
  const cache = new ScopedLruCache<string>(4);
  cache.set("live-1", "live-scope", "result-1", 1);
  cache.set("live-2", "live-scope", "result-2", 1);

  assert.equal(cache.get("live-1"), undefined);
  assert.equal(cache.get("live-2"), "result-2");
  assert.equal(cache.size, 1);

  cache.set("replay-1", "replay-scope", "replay-result-1", 2);
  cache.set("replay-2", "replay-scope", "replay-result-2", 2);
  cache.set("replay-3", "replay-scope", "replay-result-3", 2);
  assert.equal(cache.get("replay-1"), undefined);
  assert.equal(cache.get("replay-2"), "replay-result-2");
  assert.equal(cache.get("replay-3"), "replay-result-3");
  assert.equal(cache.size, 3);
});

test("runtime scheduler cancels a queued scope without affecting other scopes", async () => {
  const started: string[] = [];
  let releaseActive: (() => void) | undefined;
  const scheduler = new LatestPerScopeScheduler<ScheduledTask>({
    maxConcurrent: 1,
    run: async (task) => {
      started.push(task.id);
      if (task.id === "active") {
        await new Promise<void>((resolve) => {
          releaseActive = resolve;
        });
      }
    },
  });

  scheduler.enqueue("active-scope", { id: "active" });
  await flushMicrotasks();
  scheduler.enqueue("queued-scope", { id: "queued" });
  assert.deepEqual(scheduler.cancel("queued-scope"), { id: "queued" });
  releaseActive?.();
  await flushMicrotasks();

  assert.deepEqual(started, ["active"]);
});
