import assert from "node:assert/strict";
import { test } from "node:test";
import { SymbolSubscriptionRegistry } from "../../src/services/market-data/subscriptionRegistry";

test("removing an alert ticker retains an active chart kline subscription", () => {
  const subscriptions = new SymbolSubscriptionRegistry();
  assert.equal(subscriptions.add("EURUSD", "ticker"), true);
  assert.equal(subscriptions.add("EURUSD", "15m"), true);
  assert.equal(subscriptions.add("EURUSD", "ticker"), false);

  assert.equal(subscriptions.remove("EURUSD", "ticker"), true);
  assert.equal(subscriptions.has("EURUSD"), true);
  assert.equal(subscriptions.remove("EURUSD", "15m"), false);
  assert.equal(subscriptions.has("EURUSD"), false);
});
