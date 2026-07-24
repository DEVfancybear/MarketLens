import assert from "node:assert/strict";
import test from "node:test";
import { WatchlistSyncQueue } from "../../src/store/watchlistSyncQueue";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("serializes full-layout writes for the same watchlist", async () => {
  const queue = new WatchlistSyncQueue();
  const firstStarted = deferred();
  const firstGate = deferred();
  const order: string[] = [];

  const first = queue.enqueue("watchlist-1", async () => {
    order.push("first:start");
    firstStarted.resolve();
    await firstGate.promise;
    order.push("first:end");
  });
  const second = queue.enqueue("watchlist-1", async () => {
    order.push("second:start");
    order.push("second:end");
  });

  await firstStarted.promise;
  assert.deepEqual(order, ["first:start"]);

  firstGate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("continues with the newest layout after an earlier write fails", async () => {
  const queue = new WatchlistSyncQueue();
  const expected = new Error("first write failed");
  const order: string[] = [];

  const first = queue.enqueue("watchlist-1", async () => {
    order.push("first");
    throw expected;
  });
  const second = queue.enqueue("watchlist-1", async () => {
    order.push("second");
  });

  await assert.rejects(first, expected);
  await second;
  assert.deepEqual(order, ["first", "second"]);
});

test("allows different watchlists to sync independently", async () => {
  const queue = new WatchlistSyncQueue();
  const firstGate = deferred();
  const order: string[] = [];

  const first = queue.enqueue("watchlist-1", async () => {
    order.push("one:start");
    await firstGate.promise;
    order.push("one:end");
  });
  const second = queue.enqueue("watchlist-2", async () => {
    order.push("two");
  });

  await second;
  assert.deepEqual(order, ["one:start", "two"]);

  firstGate.resolve();
  await first;
  assert.deepEqual(order, ["one:start", "two", "one:end"]);
});
