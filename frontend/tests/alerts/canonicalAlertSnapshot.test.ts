import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fetchCanonicalActiveAlerts,
} from "../../src/server/canonicalAlertSnapshot";

test("closed-browser worker hydrates active drawing alerts from PostgreSQL", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const alerts = await fetchCanonicalActiveAlerts("signed-owner", {
    apiBase: "https://backend.test/",
    workerSecret: "worker-secret",
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({
        ok: true,
        alerts: [
          {
            id: "server-id",
            clientId: "trendline-alert",
            symbol: "BTCUSD",
            condition: "crossUp",
            price: 64_900,
            note: "Trendline",
            status: "active",
            enabled: true,
            recurring: true,
            channels: {
              sound: true,
              browser: true,
              push: false,
              telegram: true,
              discord: true,
            },
            createdAt: "2026-07-24T02:30:00Z",
            updatedAt: "2026-07-24T02:31:00Z",
            triggerPrice: 64_901,
            triggeredAt: "2026-07-24T02:30:30Z",
            armingRevision: 3,
            technicalTarget: {
              version: 1,
              kind: "dynamic-line",
              a: { time: 1_784_860_000, price: 64_800 },
              b: { time: 1_784_860_060, price: 64_900 },
              domain: "ray",
              interpolation: "linear",
            },
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal(
    requestUrl,
    "https://backend.test/api/v1/alerts/worker-snapshot",
  );
  assert.equal(
    new Headers(requestInit?.headers).get("x-push-worker-secret"),
    "worker-secret",
  );
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    deliveryToken: "signed-owner",
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].id, "trendline-alert");
  assert.equal(alerts[0].updatedAt, Date.parse("2026-07-24T02:31:00Z"));
  assert.equal(
    alerts[0].lastTriggeredAt,
    Date.parse("2026-07-24T02:30:30Z"),
  );
  assert.equal(alerts[0].triggerPrice, 64_901);
  assert.equal(alerts[0].telegram, true);
  assert.equal(alerts[0].discord, true);
  assert.equal(alerts[0].technicalTarget?.kind, "dynamic-line");
});

test("canonical snapshot fails closed and lets the worker use its durable fallback", async () => {
  await assert.rejects(
    fetchCanonicalActiveAlerts("signed-owner", {
      workerSecret: "worker-secret",
      fetchImpl: async () =>
        new Response(JSON.stringify({
          ok: true,
          alerts: [{ id: "broken" }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    }),
    /invalid alert/i,
  );
});
