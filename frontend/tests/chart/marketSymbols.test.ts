import assert from "node:assert/strict";
import test from "node:test";
import {
  twelveDataSymbol,
  twelveDataSymbolMap,
} from "../../src/services/market-data/symbols";

test("maps OANDA-primary forex symbols to TwelveData slash format", () => {
  assert.equal(twelveDataSymbol("EURUSD"), "EUR/USD");
  assert.equal(twelveDataSymbol("GBPUSD"), "GBP/USD");
  assert.equal(twelveDataSymbolMap().USDJPY, "USD/JPY");
});

test("maps OANDA-primary metal and index symbols to TwelveData fallback symbols", () => {
  assert.equal(twelveDataSymbol("XAUUSD"), "XAU/USD");
  assert.equal(twelveDataSymbol("XAGUSD"), "XAG/USD");
  assert.equal(twelveDataSymbol("SPX500"), "SPX");
  assert.equal(twelveDataSymbol("NAS100"), "IXIC");
});
