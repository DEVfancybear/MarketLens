import assert from "node:assert/strict";
import test from "node:test";
import {
  clearExecutionActivityForAccount,
  parseExecutionActivityClearCutoffs,
  shouldAppendExecutionActivity,
} from "../../src/services/execution/activityLog";

const existing = [
  {
    accountId: "mt5_a",
    dedupeKey: "command:a:failed:100",
    time: 100,
  },
  {
    accountId: "mt5_b",
    dedupeKey: "command:b:accepted:100",
    time: 100,
  },
];

test("clear removes only the selected account activity", () => {
  assert.deepEqual(clearExecutionActivityForAccount(existing, "mt5_a"), [
    existing[1],
  ]);
});

test("a cleared historical outcome cannot be restored by polling", () => {
  assert.equal(
    shouldAppendExecutionActivity(
      [],
      {
        accountId: "mt5_a",
        dedupeKey: "command:a:failed:100",
        time: 100,
      },
      { mt5_a: 200 },
    ),
    false,
  );
  assert.equal(
    shouldAppendExecutionActivity(
      [],
      {
        accountId: "mt5_a",
        dedupeKey: "command:a:accepted:201",
        time: 201,
      },
      { mt5_a: 200 },
    ),
    true,
  );
});

test("polling the same outcome twice does not duplicate the activity row", () => {
  assert.equal(
    shouldAppendExecutionActivity(
      existing,
      {
        accountId: "mt5_a",
        dedupeKey: "command:a:failed:100",
        time: 100,
      },
      {},
    ),
    false,
  );
});

test("persisted clear cutoffs reject malformed data and stay bounded", () => {
  assert.deepEqual(parseExecutionActivityClearCutoffs("not-json"), {});
  assert.deepEqual(
    parseExecutionActivityClearCutoffs(
      JSON.stringify({
        mt5_a: 200,
        mt5_b: -1,
        mt5_c: "300",
      }),
    ),
    { mt5_a: 200 },
  );
  const oversized = Object.fromEntries(
    Array.from({ length: 120 }, (_, index) => [`mt5_${index}`, index + 1]),
  );
  assert.equal(
    Object.keys(
      parseExecutionActivityClearCutoffs(JSON.stringify(oversized)),
    ).length,
    100,
  );
});
