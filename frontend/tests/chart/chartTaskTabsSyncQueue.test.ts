import assert from "node:assert/strict";
import test from "node:test";
import {
  ChartTaskTabsSyncQueue,
  type ChartTaskTabsSyncEvents,
  type ChartTaskTabsSyncRecovery,
  type ChartTaskTabsSyncTransport,
} from "../../src/services/api/chartTaskTabsSyncQueue";
import {
  activateChartTask,
  addChartTask,
  createInitialChartTaskTabs,
  type ChartTaskTabsDocument,
} from "../../src/store/chartTaskTabsStore";

test("serializes debounce and advances acknowledged revision", async () => {
  const calls: Array<{ expectedRevision: number; document: ChartTaskTabsDocument }> = [];
  const acknowledgements: ChartTaskTabsDocument[] = [];
  const harness = syncHarness({
    put: async (expectedRevision, document) => {
      calls.push({ expectedRevision, document });
      return { ...document, revision: expectedRevision + 1 };
    },
    acknowledged: (document) => acknowledgements.push(document),
  });
  const first = taskDocument(4, 1);
  const latest = activateChartTask(addChartTask(first, selection, ids(2)), "task-2");

  harness.queue.enqueue("user-1", first);
  harness.queue.enqueue("user-1", latest);
  await harness.queue.flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.expectedRevision, 4);
  assert.equal(calls[0]?.document.activeTaskId, "task-2");
  assert.equal(acknowledgements.at(-1)?.revision, 5);
  assert.deepEqual(harness.cleared, ["user-1"]);
});

test("older acknowledgement cannot overwrite a newer queued document", async () => {
  const firstResponse = deferred<ChartTaskTabsDocument>();
  const calls: Array<{ expectedRevision: number; document: ChartTaskTabsDocument }> = [];
  const acknowledged: ChartTaskTabsDocument[] = [];
  const harness = syncHarness({
    put: async (expectedRevision, document) => {
      calls.push({ expectedRevision, document });
      if (calls.length === 1) return firstResponse.promise;
      return { ...document, revision: expectedRevision + 1 };
    },
    acknowledged: (document) => acknowledged.push(document),
  });
  const first = taskDocument(7, 1);
  const second = addChartTask(first, selection, ids(2));

  harness.queue.enqueue("user-1", first);
  const flushing = harness.queue.flush();
  await Promise.resolve();
  harness.queue.enqueue("user-1", second);
  firstResponse.resolve({ ...first, revision: 8 });
  await flushing;

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.expectedRevision, 8);
  assert.equal(calls[1]?.document.tasks.length, 2);
  assert.equal(acknowledged.at(-1)?.tasks.length, 2);
  assert.equal(acknowledged.at(-1)?.revision, 9);
});

test("stale conflict preserves recovery and adopts server", async () => {
  const local = taskDocument(3, 2);
  const server = activateChartTask(taskDocument(4, 1), "task-1");
  const harness = syncHarness({
    put: async () => { throw new ConflictError(); },
    get: async () => server,
  });

  harness.queue.enqueue("user-9", local);
  await harness.queue.flush();

  assert.equal(harness.conflicts.length, 1);
  assert.strictEqual(harness.conflicts[0]?.local, local);
  assert.strictEqual(harness.conflicts[0]?.server, server);
  assert.deepEqual(harness.recovered, [{ uid: "user-9", document: local }]);
});

test("transient failure retains only latest pending document", async () => {
  let fail = true;
  const sent: ChartTaskTabsDocument[] = [];
  const harness = syncHarness({
    put: async (revision, document) => {
      sent.push(document);
      if (fail) throw new Error("offline");
      return { ...document, revision: revision + 1 };
    },
  });
  const first = taskDocument(2, 1);
  const latest = addChartTask(first, selection, ids(2));

  harness.queue.enqueue("user-1", first);
  await harness.queue.flush();
  assert.equal(harness.failures.length, 1);
  assert.strictEqual(harness.pending.at(-1)?.document, first);

  fail = false;
  harness.queue.enqueue("user-1", latest);
  await harness.queue.flush();
  assert.strictEqual(sent.at(-1), latest);
  assert.equal(harness.cleared.at(-1), "user-1");
});

test("reset isolates pending state by authenticated uid", async () => {
  const calls: ChartTaskTabsDocument[] = [];
  const harness = syncHarness({
    put: async (revision, document) => {
      calls.push(document);
      return { ...document, revision: revision + 1 };
    },
  });
  harness.queue.enqueue("user-a", taskDocument(0, 1));
  harness.queue.reset("user-a");
  await harness.queue.flush();
  assert.equal(calls.length, 0);
  assert.equal(harness.cleared.at(-1), "user-a");
});

test("a new uid drains after an older in-flight request is reset", async () => {
  const oldResponse = deferred<ChartTaskTabsDocument>();
  const calls: Array<{ uid: string; document: ChartTaskTabsDocument }> = [];
  let activeUid = "user-a";
  const pending: Array<{ uid: string; document: ChartTaskTabsDocument }> = [];
  const queue = new ChartTaskTabsSyncQueue(
    {
      put: async (revision, document) => {
        calls.push({ uid: activeUid, document });
        if (calls.length === 1) return oldResponse.promise;
        return { ...document, revision: revision + 1 };
      },
      get: async () => taskDocument(1, 1),
      isConflict: () => false,
    },
    {
      savePending: (uid, document) => pending.push({ uid, document }),
      clearPending: () => undefined,
      saveConflict: () => undefined,
    },
    {
      acknowledged: () => undefined,
      conflicted: () => undefined,
      failed: () => undefined,
    },
    0,
  );

  queue.enqueue("user-a", taskDocument(0, 1));
  const oldFlush = queue.flush();
  await Promise.resolve();
  queue.reset("user-a");
  activeUid = "user-b";
  const next = taskDocument(4, 2);
  queue.enqueue("user-b", next);
  oldResponse.resolve(taskDocument(1, 1));
  await oldFlush;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.uid, "user-b");
  assert.strictEqual(calls[1]?.document, next);
  assert.equal(pending.at(-1)?.uid, "user-b");
});

test("transient failure does not spin an automatic retry loop", async () => {
  let calls = 0;
  const failed = deferred<void>();
  const queue = new ChartTaskTabsSyncQueue(
    {
      put: async () => {
        calls += 1;
        throw new Error("offline");
      },
      get: async () => taskDocument(1, 1),
      isConflict: () => false,
    },
    {
      savePending: () => undefined,
      clearPending: () => undefined,
      saveConflict: () => undefined,
    },
    {
      acknowledged: () => undefined,
      conflicted: () => undefined,
      failed: () => failed.resolve(),
    },
    0,
  );

  queue.enqueue("user-a", taskDocument(0, 1));
  await failed.promise;
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  queue.reset("user-a");
  assert.equal(calls, 1);
});

const selection = { symbol: "EURUSD", timeframe: "15m" as const };

function ids(index: number) {
  return { taskId: `task-${index}`, drawingContextId: `scope-${index}` };
}

function taskDocument(revision: number, count: number): ChartTaskTabsDocument {
  let document = createInitialChartTaskTabs(selection, ids(1));
  for (let index = 2; index <= count; index += 1) {
    document = addChartTask(document, selection, ids(index));
  }
  return { ...document, revision };
}

class ConflictError extends Error {}

function syncHarness(overrides: Partial<ChartTaskTabsSyncTransport & ChartTaskTabsSyncEvents> = {}) {
  const pending: Array<{ uid: string; document: ChartTaskTabsDocument }> = [];
  const recovered: Array<{ uid: string; document: ChartTaskTabsDocument }> = [];
  const cleared: string[] = [];
  const conflicts: Array<{ server: ChartTaskTabsDocument; local: ChartTaskTabsDocument }> = [];
  const failures: unknown[] = [];
  const recovery: ChartTaskTabsSyncRecovery = {
    savePending: (uid, document) => pending.push({ uid, document }),
    clearPending: (uid) => cleared.push(uid),
    saveConflict: (uid, document) => recovered.push({ uid, document }),
  };
  const transport: ChartTaskTabsSyncTransport = {
    put: overrides.put ?? (async (revision, document) => ({ ...document, revision: revision + 1 })),
    get: overrides.get ?? (async () => taskDocument(1, 1)),
    isConflict: overrides.isConflict ?? ((error) => error instanceof ConflictError),
  };
  const events: ChartTaskTabsSyncEvents = {
    acknowledged: overrides.acknowledged ?? (() => undefined),
    conflicted: overrides.conflicted ?? ((server, local) => conflicts.push({ server, local })),
    failed: overrides.failed ?? ((error) => failures.push(error)),
  };
  return {
    queue: new ChartTaskTabsSyncQueue(transport, recovery, events, 60_000),
    pending,
    recovered,
    cleared,
    conflicts,
    failures,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
