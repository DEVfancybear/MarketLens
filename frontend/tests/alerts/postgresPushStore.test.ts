import assert from "node:assert/strict";
import { test } from "node:test";

import {
  listPushDevices,
  registerPushDevice,
  syncPushAlerts,
} from "../../src/server/pushAlertStore";

function device(version: number, alertState: object = {}) {
  return {
    token: "fcm-token-123456789",
    userId: "user-1",
    notificationTimeZone: "UTC",
    alerts: [],
    settingsPush: false,
    settingsTelegram: false,
    settingsDiscord: false,
    lastPrices: {},
    alertState,
    createdAt: 1_750_000_000_000,
    updatedAt: 1_750_000_000_000,
    version,
  };
}

test("push store uses the PostgreSQL worker API and never Firebase storage", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalSecret = process.env.PUSH_WORKER_SECRET;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
  process.env.PUSH_WORKER_SECRET = "worker-secret";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalBase;
    if (originalSecret === undefined) delete process.env.PUSH_WORKER_SECRET;
    else process.env.PUSH_WORKER_SECRET = originalSecret;
  });

  const requests: Array<{ url: string; method: string; secret: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      secret: new Headers(init?.headers).get("x-push-worker-secret") ?? "",
    });
    if (String(input).endsWith("/ensure")) {
      return Response.json({ ok: true, device: device(1) });
    }
    return Response.json({ ok: true, devices: [device(1)] });
  };

  await registerPushDevice("fcm-token-123456789", "firebase-user-1");
  const devices = await listPushDevices();

  assert.equal(devices.length, 1);
  assert.deepEqual(
    requests.map(({ url, method, secret }) => ({
      path: new URL(url).pathname,
      method,
      secret,
    })),
    [
      {
        path: "/api/v1/push/worker-devices/ensure",
        method: "POST",
        secret: "worker-secret",
      },
      {
        path: "/api/v1/push/worker-devices",
        method: "GET",
        secret: "worker-secret",
      },
    ],
  );
});

test("browser sync retries a PostgreSQL version conflict without losing state", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalSecret = process.env.PUSH_WORKER_SECRET;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
  process.env.PUSH_WORKER_SECRET = "worker-secret";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalBase;
    if (originalSecret === undefined) delete process.env.PUSH_WORKER_SECRET;
    else process.env.PUSH_WORKER_SECRET = originalSecret;
  });

  const putVersions: number[] = [];
  let getCalls = 0;
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith("/get")) {
      getCalls += 1;
      return Response.json({
        ok: true,
        device:
          getCalls === 1
            ? device(1)
            : device(2, {
                retained: { signature: "retained-signature", lastEvaluatedAt: 10 },
              }),
      });
    }
    if (path.endsWith("/put")) {
      putVersions.push(body.expectedVersion);
      if (putVersions.length === 1) {
        return Response.json(
          { error: { message: "push device changed concurrently" } },
          { status: 409 },
        );
      }
      return Response.json({
        ok: true,
        device: { ...body.device, version: 3 },
      });
    }
    throw new Error(`unexpected request ${path}`);
  };

  const result = await syncPushAlerts(
    {
      token: "fcm-token-123456789",
      deliveryToken: "signed-delivery-token",
      notificationTimeZone: "Asia/Ho_Chi_Minh",
      settingsPush: true,
      settingsTelegram: false,
      settingsDiscord: false,
      alerts: [
        {
          id: "alert-1",
          symbol: "EURUSD",
          condition: "above",
          price: 1.1,
          recurring: false,
          updatedAt: 1_750_000_000_000,
          armingRevision: 1,
          push: true,
          telegram: false,
          discord: false,
        },
      ],
    },
    "firebase-user-1",
  );

  assert.deepEqual(result, { stored: 1 });
  assert.deepEqual(putVersions, [1, 2]);
  assert.equal(getCalls, 2);
});

test("browser sync cancellation aborts the in-flight PostgreSQL request", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalSecret = process.env.PUSH_WORKER_SECRET;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
  process.env.PUSH_WORKER_SECRET = "worker-secret";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalBase;
    if (originalSecret === undefined) delete process.env.PUSH_WORKER_SECRET;
    else process.env.PUSH_WORKER_SECRET = originalSecret;
  });

  let observedAbort = false;
  globalThis.fetch = async (_input, init) => {
    const requestSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      requestSignal?.addEventListener(
        "abort",
        () => {
          observedAbort = true;
          reject(requestSignal.reason ?? new Error("aborted"));
        },
        { once: true },
      );
    });
  };

  const controller = new AbortController();
  const pending = syncPushAlerts(
    {
      token: "fcm-token-123456789",
      settingsPush: true,
      alerts: [],
    },
    "firebase-user-1",
    { signal: controller.signal },
  );
  controller.abort(new Error("route deadline"));

  await assert.rejects(pending, /route deadline/);
  assert.equal(observedAbort, true);
});
