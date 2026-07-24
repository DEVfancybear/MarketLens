import assert from "node:assert/strict";
import { test } from "node:test";

import { verifyFirebaseUserToken } from "../../src/server/requestSecurity";
import {
  ServerOperationTimeoutError,
  withServerOperationTimeout,
} from "../../src/server/serverOperationTimeout";

test("push auth verifies the signed Firebase token without a revocation round trip", async () => {
  const calls: Array<[string, boolean?]> = [];
  const userId = await verifyFirebaseUserToken("signed-token", {
    verifyIdToken: async (...args: [string, boolean?]) => {
      calls.push(args);
      return { uid: "firebase-user" };
    },
  });

  assert.equal(userId, "firebase-user");
  assert.deepEqual(calls, [["signed-token"]]);
});

test("push auth rejects an invalid Firebase token", async () => {
  const userId = await verifyFirebaseUserToken("invalid-token", {
    verifyIdToken: async () => {
      throw new Error("invalid signature");
    },
  });

  assert.equal(userId, null);
});

test("server operation deadline rejects a stuck idempotent registration", async () => {
  await assert.rejects(
    withServerOperationTimeout(
      "push registration",
      5,
      () => new Promise<never>(() => undefined),
    ),
    (error: unknown) => {
      assert.ok(error instanceof ServerOperationTimeoutError);
      assert.equal(error.operation, "push registration");
      assert.equal(error.timeoutMs, 5);
      return true;
    },
  );
});

test("server operation deadline preserves a prompt result", async () => {
  const result = await withServerOperationTimeout(
    "push registration",
    100,
    async () => "registered",
  );

  assert.equal(result, "registered");
});
