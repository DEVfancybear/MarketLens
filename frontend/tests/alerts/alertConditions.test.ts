import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertArmingRevision,
  alertLineRenderKey,
  conditionForTargetSide,
  findPriceConditionTrigger,
  hasAlertArmingChange,
  isPriceConditionMet,
  isTriggerPriceValid,
  previousPriceForRevision,
} from "../../src/services/alertConditions";
import {
  isFreshMt5Tick,
  isOrderedMt5Tick,
  mt5ChartPrice,
} from "../../src/services/market-data/mt5Price";

test("crossUp requires consecutive prices to cross the line", () => {
  assert.equal(isPriceConditionMet("crossUp", 1.1442, 1.1441, 1.1442), true);
  assert.equal(isPriceConditionMet("crossUp", 1.1442, undefined, 1.1443), false);
  assert.equal(isPriceConditionMet("crossUp", 1.1442, 1.1441, 1.14419), false);
  assert.equal(isPriceConditionMet("crossUp", 1.1442, 1.14421, 1.1443), false);
});

test("crossDown cannot trigger while current price remains above the line", () => {
  assert.equal(isPriceConditionMet("crossDown", 1.14372, 1.14416, 1.14372), true);
  assert.equal(isPriceConditionMet("crossDown", 1.14372, undefined, 1.1437), false);
  assert.equal(isPriceConditionMet("crossDown", 1.14372, 1.14416, 1.14412), false);
  assert.equal(isPriceConditionMet("crossDown", 1.14372, 1.1437, 1.1436), false);
});

test("closed-browser replay catches a wick that returns before the next poll", () => {
  const trigger = findPriceConditionTrigger("crossUp", 1.14392, 1.14388, [
    { price: 1.14389, timestamp: 1000 },
    { price: 1.14393, timestamp: 1100 },
    { price: 1.14388, timestamp: 1200 },
  ]);
  assert.deepEqual(trigger, { price: 1.14393, timestamp: 1100 });
});

test("level conditions use current price only", () => {
  assert.equal(isPriceConditionMet("above", 100, undefined, 100), true);
  assert.equal(isPriceConditionMet("above", 100, 101, 99), false);
  assert.equal(isPriceConditionMet("below", 100, undefined, 100), true);
  assert.equal(isPriceConditionMet("below", 100, 99, 101), false);
});

test("persistence guard rejects trigger prices on the wrong side", () => {
  assert.equal(isTriggerPriceValid("crossUp", 1.1442, 1.1441), false);
  assert.equal(isTriggerPriceValid("crossUp", 1.1442, 1.1442), true);
  assert.equal(isTriggerPriceValid("crossDown", 1.14372, 1.14412), false);
  assert.equal(isTriggerPriceValid("crossDown", 1.14372, 1.14372), true);
});

test("MT5 alert price uses Bid and excludes spread", () => {
  assert.equal(mt5ChartPrice(1.14402, 1.14404), 1.14402);
  assert.equal(mt5ChartPrice(Number.NaN, 1.14404), 1.14404);
  assert.equal(mt5ChartPrice(Number.NaN, Number.NaN), undefined);
});

test("closed-browser evaluation rejects stale MT5 ticks", () => {
  const now = 1_000_000;
  assert.equal(isFreshMt5Tick(now - 59_999, now), true);
  assert.equal(isFreshMt5Tick(now - 60_001, now), false);
  assert.equal(isFreshMt5Tick(now + 5_001, now), false);
});

test("MT5 realtime evaluation rejects invalid and out-of-order timestamps", () => {
  assert.equal(isOrderedMt5Tick(2000, undefined), true);
  assert.equal(isOrderedMt5Tick(2000, 2000), true);
  assert.equal(isOrderedMt5Tick(1999, 2000), false);
  assert.equal(isOrderedMt5Tick(Number.NaN, 2000), false);
});

test("editing or re-arming changes the arming revision", () => {
  const original = alertArmingRevision("crossUp", "EURUSD", 1.1442, false, 1000);
  assert.notEqual(
    alertArmingRevision("crossUp", "EURUSD", 1.1443, false, 1001),
    original,
  );
  assert.notEqual(
    alertArmingRevision("crossUp", "EURUSD", 1.1442, false, 1001),
    original,
  );
});

test("a new arming revision never reuses a previous market tick", () => {
  assert.equal(previousPriceForRevision("rev-2", "rev-1", 1.1441), undefined);
  assert.equal(previousPriceForRevision("rev-2", "rev-2", 1.1441), 1.1441);
});

test("dragging across market price flips direction but preserves family", () => {
  assert.equal(conditionForTargetSide("crossDown", 101, 100), "crossUp");
  assert.equal(conditionForTargetSide("crossUp", 99, 100), "crossDown");
  assert.equal(conditionForTargetSide("below", 101, 100), "above");
  assert.equal(conditionForTargetSide("above", 99, 100), "below");
});

test("native alert line rerenders when condition changes", () => {
  const up = alertLineRenderKey([{ id: "a1", condition: "crossUp", price: 100 }]);
  const down = alertLineRenderKey([
    { id: "a1", condition: "crossDown", price: 100 },
  ]);
  assert.notEqual(up, down);
});

test("only semantic alert changes re-arm recurring state", () => {
  const current = {
    symbol: "EURUSD",
    condition: "crossUp" as const,
    price: 1.1442,
    recurring: true,
    enabled: true,
  };
  assert.equal(hasAlertArmingChange(current, { price: 1.1443 }), true);
  assert.equal(hasAlertArmingChange(current, { condition: "crossDown" }), true);
  assert.equal(hasAlertArmingChange({ ...current, enabled: false }, { enabled: true }), true);
  assert.equal(hasAlertArmingChange(current, { enabled: false }), false);
  assert.equal(hasAlertArmingChange(current, {}), false);
});
