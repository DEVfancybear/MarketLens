import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { BackendJournalEntry } from "../../src/services/api/resources/journalApi";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";

type JournalApi = typeof import("../../src/services/api/resources/journalApi");
let apiPromise: Promise<JournalApi> | null = null;

function loadApi(): Promise<JournalApi> {
  apiPromise ??= import("../../src/services/api/resources/journalApi");
  return apiPromise;
}

function backendEntry(): BackendJournalEntry {
  return {
    id: "server-journal-1",
    clientId: "jrn-local-1",
    symbol: "EURUSD",
    side: "long",
    entryTime: "2026-07-11T01:00:00Z",
    exitTime: "2026-07-11T02:00:00Z",
    entryPrice: 1.1,
    exitPrice: 1.11,
    quantity: 1,
    pnl: 100,
    rr: 2,
    riskAmount: 50,
    notes: "breakout",
    tags: ["A setup"],
    screenshots: [],
    createdAt: "2026-07-11T02:00:00Z",
    updatedAt: "2026-07-11T02:00:00Z",
  };
}

test("journal adapters preserve the optimistic client id and epoch times", async () => {
  const api = await loadApi();
  const local = await api.backendJournalToLocal(backendEntry());
  assert.equal(local.id, "jrn-local-1");
  assert.equal(local.entryTime, Date.parse("2026-07-11T01:00:00Z") / 1000);
  assert.equal(local.pnl, 100);
  assert.deepEqual(api.localJournalToCreate(local), {
    clientId: "jrn-local-1",
    symbol: "EURUSD",
    side: "long",
    entryTime: "2026-07-11T01:00:00.000Z",
    exitTime: "2026-07-11T02:00:00.000Z",
    entryPrice: 1.1,
    exitPrice: 1.11,
    quantity: 1,
    pnl: 100,
    rr: 2,
    riskAmount: 50,
    notes: "breakout",
    tags: ["A setup"],
  });
});

test("journal screenshot upload sends bytes to storage and metadata to the API", async (t: TestContext) => {
  const api = await loadApi();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; host: string; path: string }> = [];
  const screenshot = {
    id: "11111111-1111-4111-8111-111111111111",
    journalEntryId: "server-journal-1",
    phase: "before" as const,
    contentType: "image/png",
    sizeBytes: 3,
    createdAt: "2026-07-11T02:00:00Z",
  };

  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    calls.push({ method: request.method, host: url.host, path: url.pathname });
    if (url.host === "storage.test") return new Response(null, { status: 200 });
    if (url.pathname.endsWith("/upload-url")) {
      return Response.json({
        uploadUrl: "https://storage.test/users/u/journal/a.png?signature=x",
        storageKey: "users/u/journal/a.png",
        expiresIn: 600,
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/screenshots")) {
      return Response.json(screenshot, { status: 201 });
    }
    if (request.method === "GET") {
      return Response.json({ url: "https://storage.test/view", expiresAt: "2026-07-11T02:15:00Z" });
    }
    return Response.json({ ok: true });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const ref = await api.uploadJournalScreenshot(
    "jrn-local-1",
    "before",
    new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
  );
  assert.equal(ref.id, screenshot.id);
  assert.equal(ref.thumb, "https://storage.test/view");
  assert.deepEqual(calls.map(({ method, host, path }) => [method, host, path]), [
    ["POST", "backend.test", "/api/v1/screenshots/upload-url"],
    ["PUT", "storage.test", "/users/u/journal/a.png"],
    ["POST", "backend.test", "/api/v1/screenshots"],
    ["GET", "backend.test", `/api/v1/screenshots/${screenshot.id}`],
  ]);
});
