import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeExecutionAccountLayout,
  moveExecutionAccountItem,
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
