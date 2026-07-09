import assert from "node:assert/strict";
import test from "node:test";
import {
  replaceMarketSymbols,
  twelveDataSymbol,
  twelveDataSymbolMap,
} from "../../src/services/market-data/symbols";
import type { MarketSymbol } from "../../src/types";

function symbol(id: string, providerSymbol = id): MarketSymbol {
  return {
    id,
    name: id,
    provider: "mt5",
    assetClass: "forex",
    exchange: "MT5",
    base: id.slice(0, 3),
    quote: id.slice(3, 6),
    pricePrecision: 5,
    tickSize: 0.00001,
    providerSymbol,
    streamable: true,
  };
}

test("MT5-first compatibility helper returns the raw symbol before catalog hydration", () => {
  replaceMarketSymbols([]);

  assert.equal(twelveDataSymbol("EURUSD"), "EURUSD");
  assert.equal(twelveDataSymbol("XAUUSD"), "XAUUSD");
  assert.deepEqual(twelveDataSymbolMap(), {});
});

test("MT5-first compatibility helper uses backend catalog provider symbols", () => {
  replaceMarketSymbols([
    symbol("EURUSD", "EURUSD.raw"),
    symbol("XAUUSD", "XAUUSD.raw"),
  ]);

  assert.equal(twelveDataSymbol("EURUSD"), "EURUSD.raw");
  assert.equal(twelveDataSymbol("XAUUSD"), "XAUUSD.raw");
  assert.equal(twelveDataSymbolMap().EURUSD, "EURUSD.raw");
  assert.equal(twelveDataSymbolMap().XAUUSD, "XAUUSD.raw");

  replaceMarketSymbols([]);
});
