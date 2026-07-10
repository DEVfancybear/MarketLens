import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertSymbolFromMessage,
  alertSymbolFromSearch,
  normalizeAlertSymbol,
} from "../../src/services/notifications/deepLink";

test("notification deep links normalize and validate alert symbols", () => {
  assert.equal(alertSymbolFromSearch("?symbol=audnzd&source=alert"), "AUDNZD");
  assert.equal(
    alertSymbolFromMessage({ type: "OPEN_ALERT_SYMBOL", symbol: " xauusd " }),
    "XAUUSD",
  );
  assert.equal(alertSymbolFromMessage({ type: "OTHER", symbol: "EURUSD" }), undefined);
  assert.equal(normalizeAlertSymbol("../../bad"), undefined);
});
