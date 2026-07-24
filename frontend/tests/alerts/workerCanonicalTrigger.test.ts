import assert from "node:assert/strict";
import { test } from "node:test";

import { acknowledgeCanonicalAlertTrigger } from "../../src/server/canonicalAlertTrigger";
import { CanonicalTriggerPersistenceError } from "../../src/server/pushAlertLifecycle";
import type {
  PendingPushAlertTrigger,
  ServerPushAlert,
} from "../../src/types/pushAlerts";

const alert: ServerPushAlert = {
  id: "trendline-alert-1",
  symbol: "BTCUSD",
  condition: "crossDown",
  price: 63_966.305,
  recurring: false,
  updatedAt: 1_752_836_800_000,
  armingRevision: 7,
  technicalTarget: {
    version: 1,
    kind: "dynamic-line",
    a: { time: 1_752_836_800, price: 63_966.305 },
    b: { time: 1_752_836_860, price: 63_966.305 },
    domain: "ray",
    interpolation: "linear",
  },
};

const candidate: PendingPushAlertTrigger = {
  triggerPrice: 63_965.72,
  targetPrice: 63_966.305,
  triggeredAt: 1_752_836_830_125,
  triggerEvidence: {
    previous: { price: 63_967, timestamp: 1_752_836_820 },
    current: { price: 63_965.72, timestamp: 1_752_836_830.125 },
  },
};

test("canonical worker trigger sends signed owner, revision, and second-based evidence", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      ok: true,
      alreadyTriggered: false,
      event: { id: "event-new" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await acknowledgeCanonicalAlertTrigger(
    "signed-user-token",
    alert,
    candidate,
    {
      apiBase: "http://backend.test/",
      workerSecret: "worker-secret",
      fetchImpl,
    },
  );

  assert.deepEqual(result, { alreadyTriggered: false, eventId: "event-new" });
  assert.equal(requestUrl, "http://backend.test/api/v1/alerts/worker-trigger");
  assert.equal(
    new Headers(requestInit?.headers).get("x-push-worker-secret"),
    "worker-secret",
  );
  const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.equal(body.deliveryToken, "signed-user-token");
  assert.equal(body.alertId, alert.id);
  assert.equal(body.armingRevision, 7);
  assert.deepEqual(body.previous, candidate.triggerEvidence.previous);
  assert.deepEqual(body.current, candidate.triggerEvidence.current);
  assert.equal(
    (body.current as { timestamp: number }).timestamp,
    candidate.triggerEvidence.current.timestamp,
  );
  assert.notEqual(
    (body.current as { timestamp: number }).timestamp,
    candidate.triggeredAt,
  );
});

test("canonical worker trigger accepts an idempotent backend acknowledgement", async () => {
  const result = await acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
    workerSecret: "secret",
    fetchImpl: async () =>
      new Response(JSON.stringify({
        ok: true,
        alreadyTriggered: true,
        event: { id: "event-existing" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  });
  assert.deepEqual(result, {
    alreadyTriggered: true,
    eventId: "event-existing",
  });
});

test("canonical worker trigger fails closed before notification delivery", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(null, { status: 200 });
  };

  await assert.rejects(
    acknowledgeCanonicalAlertTrigger(undefined, alert, candidate, {
      workerSecret: "secret",
      fetchImpl,
    }),
    /signed alert delivery token/,
  );
  await assert.rejects(
    acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
      workerSecret: "",
      fetchImpl,
    }),
    /PUSH_WORKER_SECRET/,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
      workerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "stale armingRevision" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    (error: unknown) =>
      error instanceof CanonicalTriggerPersistenceError &&
      error.message === "stale armingRevision" &&
      error.status === 400 &&
      error.retryable === false,
  );
});

test("canonical worker trigger distinguishes transient transport and server failures", async () => {
  await assert.rejects(
    acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
      workerSecret: "secret",
      fetchImpl: async () => {
        throw new TypeError("network unavailable");
      },
    }),
    (error: unknown) =>
      error instanceof CanonicalTriggerPersistenceError &&
      error.retryable === true,
  );

  await assert.rejects(
    acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
      workerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "alert is still being created" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    (error: unknown) =>
      error instanceof CanonicalTriggerPersistenceError &&
      error.status === 404 &&
      error.retryable === true,
  );

  await assert.rejects(
    acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
      workerSecret: "secret",
      fetchImpl: async () =>
        new Response("truncated", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    (error: unknown) =>
      error instanceof CanonicalTriggerPersistenceError &&
      error.retryable === true,
  );

  await assert.rejects(
    acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
      workerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "worker credential rotated" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    (error: unknown) =>
      error instanceof CanonicalTriggerPersistenceError &&
      error.status === 401 &&
      error.retryable === true,
  );

  await assert.rejects(
    acknowledgeCanonicalAlertTrigger("signed", alert, candidate, {
      workerSecret: "secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "database warming" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    (error: unknown) =>
      error instanceof CanonicalTriggerPersistenceError &&
      error.message === "database warming" &&
      error.status === 503 &&
      error.retryable === true,
  );
});
