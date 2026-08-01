import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfileInitialBalance } from "../../src/services/execution/propRiskProfile";

test("reference balance resolution is profile data driven", () => {
  const balances = [25_000, 50_000, 100_000];

  assert.equal(
    resolveProfileInitialBalance("referenceBalances", balances, 45_698.07),
    50_000,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", balances, 37_000),
    50_000,
  );
  assert.equal(resolveProfileInitialBalance("manual", balances, 12_345), 12_345);
});

test("reference balance resolution rejects unusable telemetry", () => {
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [50_000], undefined),
    undefined,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [50_000], Number.NaN),
    undefined,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [50_000], 0),
    undefined,
  );
  assert.equal(
    resolveProfileInitialBalance("referenceBalances", [0, Number.NaN], 12_345),
    undefined,
  );
});
