import assert from "node:assert/strict";
import test from "node:test";
import {
  executionAccountDropEdge,
  mergeExecutionAccountLayout,
  moveExecutionAccountItem,
  shouldActivateExecutionAccountDrag,
} from "../../src/services/execution/accountLayout";

test("persisted layout orders simulator and broker accounts", () => {
  const accounts = [
    { id: "simulator:local" },
    { id: "mt5_a" },
    { id: "mt5_b" },
  ];

  assert.deepEqual(
    mergeExecutionAccountLayout(accounts, ["mt5_b", "simulator:local", "mt5_a"]),
    [accounts[2], accounts[0], accounts[1]],
  );
});

test("new accounts append and stale or duplicate layout items are ignored", () => {
  const accounts = [
    { id: "simulator:local" },
    { id: "mt5_a" },
    { id: "mt5_new" },
  ];

  assert.deepEqual(
    mergeExecutionAccountLayout(accounts, [
      "mt5_a",
      "removed_account",
      "mt5_a",
      "simulator:old",
      "simulator:local",
    ]),
    [accounts[1], accounts[0], accounts[2]],
  );
});

test("move helper handles both drop edges without losing items", () => {
  const items = ["simulator:local", "mt5_a", "mt5_b"];

  assert.deepEqual(
    moveExecutionAccountItem(items, "mt5_b", "simulator:local", "before"),
    ["mt5_b", "simulator:local", "mt5_a"],
  );
  assert.deepEqual(
    moveExecutionAccountItem(items, "simulator:local", "mt5_b", "after"),
    ["mt5_a", "mt5_b", "simulator:local"],
  );
  assert.deepEqual(
    moveExecutionAccountItem(items, "mt5_a", "mt5_a", "before"),
    items,
  );
});

test("account drag uses the same two-axis threshold as Watchlist rows", () => {
  assert.equal(shouldActivateExecutionAccountDrag(10, 20, 13, 24), false);
  assert.equal(shouldActivateExecutionAccountDrag(10, 20, 16, 20), true);
  assert.equal(shouldActivateExecutionAccountDrag(10, 20, 10, 26), true);
});

test("account row drop edge follows the final pointer half", () => {
  assert.equal(executionAccountDropEdge(119, 100, 40), "before");
  assert.equal(executionAccountDropEdge(120, 100, 40), "after");
  assert.equal(executionAccountDropEdge(139, 100, 40), "after");
});
