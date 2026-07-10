import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isPriceConditionMet,
  isTriggerPriceValid,
} from "../../src/services/alertConditions";
import { mt5ChartPrice } from "../../src/services/market-data/mt5Price";

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
