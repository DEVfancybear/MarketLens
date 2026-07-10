import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore } from "jotai";
import {
  setAuthUserAtom,
  backendSessionResolvedAtom,
  setWorkspaceReadyAtom,
  workspaceReadyAtom,
} from "../../src/store/authStore";

const user = {
  uid: "user-1",
  email: "user@example.com",
  displayName: "User",
  photoUrl: null,
};

test("identity changes close the push runtime gate until bootstrap completes", () => {
  const store = createStore();
  store.set(setWorkspaceReadyAtom, true);

  store.set(setAuthUserAtom, user);
  assert.equal(store.get(workspaceReadyAtom), false);
  assert.equal(store.get(backendSessionResolvedAtom), false);

  store.set(setWorkspaceReadyAtom, true);
  store.set(setAuthUserAtom, user);
  assert.equal(store.get(workspaceReadyAtom), true);
});
