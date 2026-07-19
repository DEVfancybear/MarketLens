import assert from "node:assert/strict";
import { test } from "node:test";

import type { BackendDrawingWrite } from "../../src/services/api/resources/drawingsApi";
import {
  DrawingSyncQueue,
  type DrawingSyncQueueSnapshot,
} from "../../src/components/chart/drawing/persistence/DrawingSyncQueue";

function write(revision: number): BackendDrawingWrite {
  return {
    symbol: "EURUSD",
    toolType: "trendline",
    clientId: "dw-1",
    clientRevision: revision,
    expectedRevision: revision - 1 || undefined,
    locked: false,
    hidden: false,
    payload: {
      schemaVersion: 1,
      id: "dw-1",
      tool: "trendline",
      color: "#2962ff",
      lineWidth: 1.5,
      clientRevision: revision,
      points: [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
      ],
    },
  };
}

test("outbox coalesces writes and preserves the newest client revision", async () => {
  const requests: BackendDrawingWrite[][] = [];
  const queue = new DrawingSyncQueue({
    send: async ({ upserts }) => {
      requests.push(upserts);
      return { upserted: [], deleted: 0 };
    },
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
  });
  queue.enqueueUpsert(write(1));
  queue.enqueueUpsert(write(2));
  await queue.flushNow();
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0].clientRevision, 2);
});

test("failed batches restore the outbox, persist it, and schedule retry", async () => {
  const snapshots: DrawingSyncQueueSnapshot[] = [];
  const delays: number[] = [];
  const queue = new DrawingSyncQueue({
    send: async () => {
      throw new Error("offline");
    },
    persist: (snapshot) => snapshots.push(structuredClone(snapshot)),
    schedule: (_callback, delay) => {
      delays.push(delay);
      return delays.length as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: () => {},
    debounceMs: 10,
  });
  queue.enqueueUpsert(write(1));
  await queue.flushNow();
  assert.equal(queue.size, 1);
  assert.equal(queue.snapshot().retryAttempt, 1);
  assert.ok(delays.includes(20));
  assert.equal(snapshots.at(-1)?.upserts.length, 1);
});

test("anonymous outbox hydrates and resumes after authentication", async () => {
  let authenticated = false;
  let sent = 0;
  const queue = new DrawingSyncQueue({
    canSend: () => authenticated,
    send: async () => {
      sent++;
      return { upserted: [], deleted: 0 };
    },
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
  });
  queue.hydrate({ upserts: [write(1)], deletes: [], retryAttempt: 0 });
  await queue.flushNow();
  assert.equal(sent, 0);
  authenticated = true;
  await queue.flushNow();
  assert.equal(sent, 1);
});

test("in-flight requests remain in the persisted snapshot until acknowledged", async () => {
  let resolveRequest!: (value: { upserted: []; deleted: number }) => void;
  const request = new Promise<{ upserted: []; deleted: number }>((resolve) => {
    resolveRequest = resolve;
  });
  const queue = new DrawingSyncQueue({
    send: async () => request,
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
  });
  queue.enqueueUpsert(write(1));
  const flushing = queue.flushNow();
  assert.equal(queue.snapshot().upserts.length, 1);
  queue.preserveAndCancel();
  assert.equal(queue.snapshot().upserts[0].clientId, "dw-1");
  resolveRequest({ upserted: [], deleted: 0 });
  await flushing;
  assert.equal(queue.snapshot().upserts.length, 0);
});

test("acknowledged writes rebase a newer edit queued while the request was in flight", async () => {
  let resolveFirst!: (value: {
    upserted: Array<{
      id: string;
      symbol: string;
      toolType: string;
      clientId: string;
      payload: BackendDrawingWrite["payload"];
      locked: boolean;
      hidden: boolean;
      revision: number;
      clientRevision: number;
      createdAt: string;
      updatedAt: string;
    }>;
    deleted: number;
  }) => void;
  const firstResponse = new Promise<Parameters<typeof resolveFirst>[0]>((resolve) => {
    resolveFirst = resolve;
  });
  const requests: BackendDrawingWrite[][] = [];
  const queue = new DrawingSyncQueue({
    send: async ({ upserts }) => {
      requests.push(structuredClone(upserts));
      if (requests.length === 1) return firstResponse;
      return { upserted: [], deleted: 0 };
    },
    schedule: () => 1 as unknown as ReturnType<typeof setTimeout>,
    cancel: () => {},
  });

  queue.enqueueUpsert({ ...write(1), expectedRevision: 7 });
  const firstFlush = queue.flushNow();
  queue.enqueueUpsert({ ...write(2), expectedRevision: 7 });
  resolveFirst({
    upserted: [
      {
        id: "server-1",
        symbol: "EURUSD",
        toolType: "trendline",
        clientId: "dw-1",
        payload: write(1).payload,
        locked: false,
        hidden: false,
        revision: 8,
        clientRevision: 1,
        createdAt: "",
        updatedAt: "",
      },
    ],
    deleted: 0,
  });
  await firstFlush;
  await queue.flushNow();

  assert.equal(requests.length, 2);
  assert.equal(requests[1][0].clientRevision, 2);
  assert.equal(requests[1][0].expectedRevision, 8);
});
