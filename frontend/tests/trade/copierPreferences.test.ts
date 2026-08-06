import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";

import {
  COPIER_NUMERIC_LIMITS,
  normalizeTradeCopierPreferences,
} from "../../src/services/execution/copierPreferences";
import {
  applyCopyRoutesAtom,
  copyRoutesAtom,
  copyRoutesHydratedAtom,
  copyTargetsAtom,
  resetCopyRoutesAtom,
  selectedExecutionAccountIdAtom,
  setCopyTargetAtom,
} from "../../src/store/executionRegistryStore";

test("copier preferences normalize modes, numeric bounds, and malformed routes", () => {
  const preferences = normalizeTradeCopierPreferences({
    version: 1,
    routes: {
      "source-a": {
        "source-a": target("source-a", "sameQuantity"),
        "target-same": target("target-same", "sameQuantity"),
        "target-fixed": {
          ...target("target-fixed", "fixedQuantity"),
          multiplier: Number.MAX_VALUE,
          fixedQuantity: Number.MAX_VALUE,
          maxQuantity: Number.MAX_VALUE,
          riskBasisPoints: Number.MAX_VALUE,
        },
        "target-multiplier": target("target-multiplier", "multiplier"),
        "target-equity": target("target-equity", "equityProportional"),
        "target-risk": target("target-risk", "riskPercent"),
        "target-mismatch": target("some-other-account", "sameQuantity"),
        "target-invalid-mode": target("target-invalid-mode", "unknown"),
        "target-non-finite": {
          ...target("target-non-finite", "multiplier"),
          multiplier: Number.NaN,
        },
      },
    },
  });

  assert.deepEqual(Object.keys(preferences.routes["source-a"] ?? {}).sort(), [
    "target-equity",
    "target-fixed",
    "target-multiplier",
    "target-risk",
    "target-same",
  ]);
  assert.deepEqual(preferences.routes["source-a"]?.["target-fixed"], {
    accountId: "target-fixed",
    enabled: true,
    allocationMode: "fixedQuantity",
    multiplier: COPIER_NUMERIC_LIMITS.multiplier.max,
    fixedQuantity: COPIER_NUMERIC_LIMITS.quantity.max,
    riskBasisPoints: COPIER_NUMERIC_LIMITS.riskBasisPoints.max,
    maxQuantity: COPIER_NUMERIC_LIMITS.quantity.max,
  });
  assert.deepEqual(normalizeTradeCopierPreferences({ version: 2, routes: {} }), {
    version: 1,
    routes: {},
  });
});

test("copy target drafts remain isolated per selected source account", () => {
  const store = createStore();

  store.set(selectedExecutionAccountIdAtom, "source-a");
  store.set(setCopyTargetAtom, {
    accountId: "target-shared",
    enabled: true,
    allocationMode: "multiplier",
    multiplier: 2,
  });

  store.set(selectedExecutionAccountIdAtom, "source-b");
  assert.deepEqual(store.get(copyTargetsAtom), {});
  store.set(copyTargetsAtom, {
    "target-shared": {
      accountId: "target-shared",
      enabled: false,
      allocationMode: "fixedQuantity",
      multiplier: 1,
      fixedQuantity: 0.25,
    },
  });

  store.set(selectedExecutionAccountIdAtom, "source-a");
  assert.equal(store.get(copyTargetsAtom)["target-shared"]?.multiplier, 2);
  assert.equal(
    store.get(copyRoutesAtom)["source-b"]?.["target-shared"]?.fixedQuantity,
    0.25,
  );
});

test("applying and resetting copy routes controls hydration state", () => {
  const store = createStore();
  store.set(applyCopyRoutesAtom, {
    "source-a": {
      "target-a": target("target-a", "sameQuantity"),
      "source-a": target("source-a", "sameQuantity"),
    },
  });

  assert.equal(store.get(copyRoutesHydratedAtom), true);
  assert.deepEqual(Object.keys(store.get(copyRoutesAtom)["source-a"] ?? {}), [
    "target-a",
  ]);

  store.set(resetCopyRoutesAtom);
  assert.deepEqual(store.get(copyRoutesAtom), {});
  assert.equal(store.get(copyRoutesHydratedAtom), false);
});

function target(accountId: string, allocationMode: string) {
  return {
    accountId,
    enabled: true,
    allocationMode,
    multiplier: 1,
  };
}
