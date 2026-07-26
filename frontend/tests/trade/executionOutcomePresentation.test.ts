import assert from "node:assert/strict";
import test from "node:test";
import {
  isTerminalExecutionOutcome,
  presentExecutionOutcome,
  type ExecutionOutcomeLike,
} from "../../src/services/execution/outcomePresentation";

const base: ExecutionOutcomeLike = {
  commandId: "exec_child",
  parentCommandId: "exec_parent",
  status: "accepted",
  updatedAtMs: 1_000,
};

test("presents a broker deal acknowledgement as a successful fill", () => {
  const result = presentExecutionOutcome(
    { ...base, brokerOrderId: "100", brokerDealId: "200" },
    "FTMO Live",
  );

  assert.equal(result.level, "info");
  assert.equal(result.toast?.variant, "success");
  assert.equal(result.toast?.title, "Order filled on FTMO Live");
  assert.equal(result.toast?.message, "Deal #200");
});

test("does not mislabel an acknowledgement timeout as broker rejection", () => {
  const result = presentExecutionOutcome(
    {
      ...base,
      status: "unknown",
      rejectCode: "DELIVERY_OUTCOME_UNKNOWN",
      message: "EA acknowledgement timed out",
    },
    "FTMO Live",
  );

  assert.equal(result.level, "warn");
  assert.equal(result.toast?.variant, "warn");
  assert.equal(result.toast?.duration, 0);
  assert.equal(result.toast?.title, "Check MT5 before trading again");
  assert.match(result.toast?.message ?? "", /may already exist in MT5/);
  assert.doesNotMatch(result.toast?.title ?? "", /rejected/i);
});

test("keeps legacy delivery expiry fail-safe during rolling deployment", () => {
  const result = presentExecutionOutcome(
    {
      ...base,
      status: "failed",
      rejectCode: "DELIVERY_EXPIRED",
    },
    "FTMO Live",
  );

  assert.equal(result.toast?.variant, "warn");
  assert.equal(result.toast?.title, "Check MT5 before trading again");
});

test("distinguishes a command never delivered from a broker rejection", () => {
  const result = presentExecutionOutcome(
    {
      ...base,
      status: "failed",
      rejectCode: "DELIVERY_UNAVAILABLE",
    },
    "FTMO Live",
  );

  assert.equal(result.toast?.variant, "error");
  assert.equal(result.toast?.title, "Command not delivered to FTMO Live");
});

test("uses broker rejection only for a confirmed failure outcome", () => {
  const result = presentExecutionOutcome(
    { ...base, status: "failed", message: "Invalid volume" },
    "FTMO Live",
  );

  assert.equal(result.toast?.variant, "error");
  assert.equal(
    result.toast?.title,
    "Broker rejected command on FTMO Live",
  );
});

test("includes all broker terminal outcomes in activity processing", () => {
  for (const status of [
    "accepted",
    "partially_filled",
    "filled",
    "cancelled",
    "failed",
    "rejected",
    "unknown",
  ] as const) {
    assert.equal(isTerminalExecutionOutcome(status), true);
  }
  assert.equal(isTerminalExecutionOutcome("queued"), false);
});
