import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "jotai";
import {
  backendSessionAtom,
  setAuthUserAtom,
  setBackendSessionAtom,
} from "../../src/store/authStore";
import {
  copyTargetsAtom,
  executionAccountLayoutAtom,
  executionAccountLayoutPendingAtom,
  executionAccountsAtom,
  resetExecutionRegistryAtom,
  selectedExecutionAccountIdAtom,
} from "../../src/store/executionRegistryStore";

test("identity changes invalidate the previous backend session immediately", () => {
  const store = createStore();
  store.set(setAuthUserAtom, {
    uid: "owner-a",
    email: "a@example.com",
    displayName: "A",
    photoUrl: null,
  });
  store.set(setBackendSessionAtom, true);

  store.set(setAuthUserAtom, {
    uid: "owner-b",
    email: "b@example.com",
    displayName: "B",
    photoUrl: null,
  });

  assert.equal(store.get(backendSessionAtom), false);
});

test("execution registry reset removes all previous-user account projections", () => {
  const store = createStore();
  store.set(executionAccountsAtom, [
    {
      id: "account-a",
      label: "Previous broker",
      venueKind: "metatrader5",
      brokerCode: "broker",
      externalAccountRef: "123",
      mode: "live",
      status: "ready",
      currency: "USD",
      tradeAllowed: true,
    },
  ]);
  store.set(executionAccountLayoutAtom, {
    itemIds: ["account-a"],
    revision: 7,
  });
  store.set(executionAccountLayoutPendingAtom, true);
  store.set(selectedExecutionAccountIdAtom, "account-a");
  store.set(copyTargetsAtom, {
    "account-a": {
      accountId: "account-a",
      enabled: true,
      allocationMode: "sameQuantity",
      multiplier: 1,
    },
  });

  store.set(resetExecutionRegistryAtom);

  assert.deepEqual(store.get(executionAccountsAtom), []);
  assert.deepEqual(store.get(executionAccountLayoutAtom), {
    itemIds: [],
    revision: 0,
  });
  assert.equal(store.get(executionAccountLayoutPendingAtom), false);
  assert.equal(store.get(selectedExecutionAccountIdAtom), null);
  assert.deepEqual(store.get(copyTargetsAtom), {});
});
