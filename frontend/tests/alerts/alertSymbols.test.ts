import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertSymbolsEqual,
  normalizeAlertSymbol,
  resolveObservedSymbol,
  resolveAlertSymbol,
} from "../../src/services/alertSymbols";

test("alert symbols are canonicalized before quote and push lookup", () => {
  assert.equal(normalizeAlertSymbol("  eurusd.m "), "EURUSD.M");
  assert.equal(resolveAlertSymbol("btcusdt", new Set(["BTCUSD"])), "BTCUSD");
  assert.equal(resolveAlertSymbol("BTCUSD", new Set(["BTCUSDT"])), "BTCUSDT");
  assert.equal(resolveAlertSymbol("XAUUSD.m", new Set(["XAUUSD.M"])), "XAUUSD.M");
  assert.equal(resolveAlertSymbol("UNKNOWN", new Set(["EURUSD"])), undefined);
  assert.equal(alertSymbolsEqual("BTCUSDT", "BTCUSD"), true);
  assert.equal(alertSymbolsEqual("EURUSD", "GBPUSD"), false);
});

test("alert symbols resolve unique MT5 broker suffixes from catalog metadata", () => {
  const catalog = [
    { id: "EURUSDM", base: "EUR", quote: "USD" },
    { id: "BTCUSD.R", base: "BTC", quote: "USD" },
    { id: "GOLD", base: "XAU", quote: "USD" },
  ];
  assert.equal(resolveAlertSymbol("EURUSD", catalog), "EURUSDM");
  assert.equal(resolveAlertSymbol("BTCUSDT", catalog), "BTCUSD.R");
  assert.equal(resolveAlertSymbol("XAUUSD", catalog), "GOLD");
  assert.equal(alertSymbolsEqual("EURUSD", "EURUSDm", catalog), true);
});

test("alert symbol resolution fails closed for ambiguous broker variants", () => {
  const catalog = [
    { id: "EURUSDM", base: "EUR", quote: "USD" },
    { id: "EURUSD.RAW", base: "EUR", quote: "USD" },
  ];
  assert.equal(resolveAlertSymbol("EURUSD", catalog), undefined);
});

test("alert symbols resolve unique non-currency broker suffixes", () => {
  const catalog = [
    { id: "US30.cash" },
    { id: "AAPL.r" },
  ];
  assert.equal(resolveAlertSymbol("US30", catalog), "US30.CASH");
  assert.equal(resolveAlertSymbol("AAPL", catalog), "AAPL.R");
  assert.equal(resolveAlertSymbol("US30.cash", [{ id: "US30" }]), "US30");
  assert.equal(alertSymbolsEqual("US30", "US30.cash"), true);
});

test("non-currency broker variants also fail closed when ambiguous", () => {
  const catalog = [{ id: "US30.cash" }, { id: "US30.raw" }];
  assert.equal(resolveAlertSymbol("US30", catalog), undefined);
  assert.equal(alertSymbolsEqual("US30", "US30.cash", catalog), false);
});

test("observed quote resolution accepts one broker variant and rejects ambiguity", () => {
  assert.equal(resolveObservedSymbol("US30", ["US30.CASH"]), "US30.CASH");
  assert.equal(
    resolveObservedSymbol("US30", ["US30.CASH", "US30.RAW"]),
    undefined,
  );
});
