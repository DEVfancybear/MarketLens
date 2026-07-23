import assert from "node:assert/strict";
import { test } from "node:test";
import { PushAlertSyncQueue } from "../../src/services/notifications/pushAlertSyncQueue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("push snapshot writes for one device are serialized in enqueue order", async () => {
  const queue = new PushAlertSyncQueue();
  const first = deferred<string>();
  const calls: string[] = [];

  const firstResult = queue.enqueue("device-1", async () => {
    calls.push("first");
    return first.promise;
  });
  const secondResult = queue.enqueue("device-1", async () => {
    calls.push("second");
    return "newest";
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["first"]);
  first.resolve("old");
  assert.equal(await firstResult, "old");
  assert.equal(await secondResult, "newest");
  assert.deepEqual(calls, ["first", "second"]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(queue.pendingDevices(), 0);
});

test("a failed snapshot does not permanently block later snapshots", async () => {
  const queue = new PushAlertSyncQueue();
  const result = queue.enqueue("device-1", async () => {
    throw new Error("network");
  });
  await assert.rejects(result, /network/);

  assert.equal(
    await queue.enqueue("device-1", async () => "recovered"),
    "recovered",
  );
});
