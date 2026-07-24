import assert from "node:assert/strict";
import { test } from "node:test";

import {
  postAuthenticatedPushJson,
  PUSH_REQUEST_TIMEOUT_MESSAGE,
} from "../../src/services/notifications/pushRequest";

test("idempotent push registration retries one transient abort", async () => {
  let calls = 0;
  const result = await postAuthenticatedPushJson(
    "/api/push/register",
    { token: "fcm-token" },
    {
      idToken: "firebase-token",
      retries: 1,
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          throw new DOMException(
            "signal is aborted without reason",
            "AbortError",
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test("push request timeout never exposes the browser's raw abort reason", async () => {
  let calls = 0;
  const result = await postAuthenticatedPushJson(
    "/api/push/register",
    { token: "fcm-token" },
    {
      idToken: "firebase-token",
      timeoutMs: 5,
      retries: 1,
      retryDelayMs: 0,
      fetchImpl: async (_input, init) => {
        calls += 1;
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          signal.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException(
                  "signal is aborted without reason",
                  "AbortError",
                ),
              ),
            { once: true },
          );
        });
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: PUSH_REQUEST_TIMEOUT_MESSAGE,
  });
  assert.equal(calls, 2);
});

test("push request does not retry a permanent server rejection", async () => {
  let calls = 0;
  const result = await postAuthenticatedPushJson(
    "/api/push/register",
    { token: "fcm-token" },
    {
      idToken: "firebase-token",
      retries: 1,
      retryDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({ error: "Push token belongs to another user." }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: "Push token belongs to another user.",
  });
  assert.equal(calls, 1);
});
