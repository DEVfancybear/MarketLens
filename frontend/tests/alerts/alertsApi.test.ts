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
  };
}

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
  });
  assert.equal(localAlertToPatch(local).status, undefined);

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
  await api.triggerAlert("alert-1", 1.126);
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
  assert.deepEqual(calls[2].body, { triggerPrice: 1.126 });
  assert.deepEqual(calls[4].body, {
    fcmToken: "token/1",
    platform: "web",
    permission: "granted",
  });
});
