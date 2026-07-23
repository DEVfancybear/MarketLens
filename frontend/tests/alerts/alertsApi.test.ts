import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";

type AlertsApiModule = typeof import("../../src/services/api/resources/alertsApi");

let apiPromise: Promise<AlertsApiModule> | null = null;

function loadApi(): Promise<AlertsApiModule> {
  apiPromise ??= import("../../src/services/api/resources/alertsApi");
  return apiPromise;
}

function backendAlert(): Awaited<ReturnType<AlertsApiModule["createAlert"]>> {
  return {
    id: "server-alert-1",
    clientId: "alert-1",
    symbol: "EURUSD",
    condition: "crossUp",
    price: 1.125,
    note: "breakout",
    status: "active",
    enabled: true,
    locked: false,
    recurring: false,
    channels: {
      sound: true,
      browser: false,
      push: true,
      telegram: false,
      discord: true,
    },
    createdAt: "2026-07-10T01:00:00Z",
    updatedAt: "2026-07-10T01:01:00Z",
    armingRevision: 1,
  };
}

const drawingSource = {
  kind: "drawing" as const,
  drawingId: "dw-1",
  drawingTool: "horizontal" as const,
  targetId: "point:0",
  targetLabel: "Price level",
  snapshotAt: 1_750_000_000_000,
};

test("backend alert adapters preserve the optimistic client id and channels", async () => {
  const {
    backendAlertEventToLocal,
    backendAlertToLocal,
    localAlertToCreate,
    localAlertToPatch,
  } = await loadApi();
  const local = backendAlertToLocal(backendAlert());

  assert.equal(local.id, "alert-1");
  assert.equal(local.createdAt, Date.parse("2026-07-10T01:00:00Z") / 1000);
  assert.equal(local.push, true);
  assert.equal(local.discord, true);
  assert.equal(local.status, "active");

  assert.deepEqual(localAlertToCreate(local), {
    clientId: "alert-1",
    symbol: "EURUSD",
    condition: "crossUp",
    price: 1.125,
    note: "breakout",
    recurring: false,
    enabled: true,
    locked: false,
    channels: {
      sound: true,
      browser: false,
      push: true,
      telegram: false,
      discord: true,
    },
    armingRevision: 1,
  });
  assert.equal(localAlertToPatch(local).status, undefined);
  assert.equal(localAlertToPatch(local).armingRevision, 1);

  const history = backendAlertEventToLocal({
    id: "event-1",
    alertId: "alert-1",
    symbol: "EURUSD",
    condition: "crossUp",
    targetPrice: 1.125,
    triggerPrice: 1.126,
    triggeredAt: "2026-07-10T01:02:00Z",
    delivered: false,
  });
  assert.equal(history.triggerTime, Date.parse("2026-07-10T01:02:00Z") / 1000);
  assert.equal(history.alertId, "alert-1");
});

test("alert and push resource methods use the Phase 10 API routes", async (t) => {
  const api = await loadApi();
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const responses: unknown[] = [
    backendAlert(),
    backendAlert(),
    { alert: backendAlert(), event: {} },
    { ok: true },
    {
      id: "push-1",
      fcmToken: "token/1",
      platform: "web",
      permission: "granted",
      createdAt: "2026-07-10T01:00:00Z",
      lastSeenAt: "2026-07-10T01:00:00Z",
    },
    { ok: true },
  ];

  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const text = await request.clone().text();
    calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text ? JSON.parse(text) : null,
    });
    return new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const createBody = api.localAlertToCreate(api.backendAlertToLocal(backendAlert()));
  await api.createAlert(createBody);
  await api.patchAlert("alert-1", { enabled: false });
  await api.triggerAlert(
    "alert-1",
    1.126,
    1.1255,
    {
      previous: { price: 1.124, timestamp: 1_752_109_200 },
      current: { price: 1.126, timestamp: 1_752_109_260 },
    },
    1,
  );
  await api.clearAlertHistory();
  await api.registerPushToken({
    fcmToken: "token/1",
    platform: "web",
    permission: "granted",
  });
  await api.deletePushToken("token/1");

  assert.deepEqual(
    calls.map(({ method, path }) => [method, path]),
    [
      ["POST", "/api/v1/alerts"],
      ["PATCH", "/api/v1/alerts/alert-1"],
      ["POST", "/api/v1/alerts/alert-1/trigger"],
      ["DELETE", "/api/v1/alerts/history"],
      ["POST", "/api/v1/push/tokens"],
      ["DELETE", "/api/v1/push/tokens/token%2F1"],
    ],
  );
  assert.deepEqual(calls[2].body, {
    triggerPrice: 1.126,
    targetPrice: 1.1255,
    previous: { price: 1.124, timestamp: 1_752_109_200 },
    current: { price: 1.126, timestamp: 1_752_109_260 },
    armingRevision: 1,
  });
  assert.deepEqual(calls[4].body, {
    fcmToken: "token/1",
    platform: "web",
    permission: "granted",
  });
});

test("alert API surfaces the backend 400 reason instead of a generic status", async (t) => {
  const api = await loadApi();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: "alerts: bad request: drawing alert source is invalid",
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      },
    )) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const createBody = api.localAlertToCreate(
    api.backendAlertToLocal(backendAlert()),
  );
  await assert.rejects(
    api.createAlert(createBody),
    /drawing alert source is invalid/i,
  );
});

test("drawing alert provenance round-trips on create and stays immutable on patch", async () => {
  const { backendAlertToLocal, localAlertToCreate, localAlertToPatch } = await loadApi();
  const local = backendAlertToLocal({ ...backendAlert(), source: drawingSource });
  assert.deepEqual(local.source, drawingSource);
  assert.deepEqual(localAlertToCreate(local).source, drawingSource);
  assert.equal("source" in localAlertToPatch(local), false);
});

test("backend adapter fails closed on malformed technical geometry", async () => {
  const { backendAlertToLocal } = await loadApi();
  assert.throws(
    () => backendAlertToLocal({
      ...backendAlert(),
      technicalTarget: {
        version: 1,
        kind: "dynamic-line",
        a: { time: 1_750_000_000, price: 1.12 },
        b: { time: 1_750_000_000, price: 1.13 },
        domain: "segment",
        interpolation: "linear",
      },
    }),
    /invalid technical target/i,
  );
});

test("backend adapter rejects malformed rows before they can re-sync", async () => {
  const { backendAlertEventToLocal, backendAlertToLocal } = await loadApi();
  assert.throws(
    () => backendAlertToLocal({ ...backendAlert(), symbol: " ", price: 0 }),
    /identity or symbol/i,
  );
  assert.throws(
    () =>
      backendAlertToLocal({
        ...backendAlert(),
        source: { ...drawingSource, snapshotAt: Number.NaN },
      }),
    /invalid drawing source/i,
  );
  assert.throws(
    () =>
      backendAlertEventToLocal({
        id: "event-1",
        alertId: "alert-1",
        symbol: "EURUSD",
        condition: "crossUp",
        targetPrice: 1.125,
        triggerPrice: 1.126,
        triggeredAt: "not-a-date",
        delivered: false,
      }),
    /invalid timestamp/i,
  );
});
