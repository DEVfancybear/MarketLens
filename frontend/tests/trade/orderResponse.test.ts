import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExecutionOrderResponse } from "../../src/services/execution/orderResponse";

test("normalizes legacy snake-case target identities during a rolling deployment", () => {
  const response = normalizeExecutionOrderResponse({
    commandId: "parent",
    targets: [
      {
        status: "unavailable",
        account_id: "mt5_exness",
        code: "ACCOUNT_OFFLINE",
        message: "target account is offline",
      },
    ],
  });

  assert.deepEqual(response, {
    commandId: "parent",
    targets: [
      {
        status: "unavailable",
        accountId: "mt5_exness",
        code: "ACCOUNT_OFFLINE",
        message: "target account is offline",
      },
    ],
  });
});

test("normalizes the five-minute waiting response", () => {
  const response = normalizeExecutionOrderResponse({
    command_id: "parent",
    targets: [
      {
        status: "waiting",
        account_id: "mt5_exness",
        command_id: "parent:mt5_exness",
        expires_at_ms: 300_000,
      },
    ],
  });

  assert.equal(response.targets[0]?.status, "waiting");
  assert.deepEqual(response.targets[0], {
    status: "waiting",
    accountId: "mt5_exness",
    commandId: "parent:mt5_exness",
    expiresAtMs: 300_000,
  });
});

test("rejects malformed target responses instead of showing undefined feedback", () => {
  assert.throws(
    () =>
      normalizeExecutionOrderResponse({
        commandId: "parent",
        targets: [{ status: "rejected", message: "no account id" }],
      }),
    /accountId/,
  );
});
