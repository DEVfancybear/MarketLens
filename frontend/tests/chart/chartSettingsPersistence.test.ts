import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeChartSymbol,
  resolveCurrentChartSymbol,
} from "../../src/services/chartSettingsPersistence";

test("chart symbols are normalized before persistence", () => {
  assert.equal(normalizeChartSymbol("  btcusd  "), "BTCUSD");
  assert.equal(normalizeChartSymbol(null), "");
});

test("the backend selection wins after acknowledgement", () => {
  assert.equal(
    resolveCurrentChartSymbol({
      remote: "XAUUSD",
      local: "BTCUSD",
      localWritePending: false,
    }),
    "XAUUSD",
  );
});

test("an unsent local selection survives refresh until the backend catches up", () => {
  assert.equal(
    resolveCurrentChartSymbol({
      remote: "EURUSD",
      local: "BTCUSD",
      localWritePending: true,
    }),
    "BTCUSD",
  );
});

test("EURUSD is used only when no persisted remote selection exists", () => {
  assert.equal(
    resolveCurrentChartSymbol({
      remote: undefined,
      local: undefined,
      localWritePending: false,
    }),
    "EURUSD",
  );
});
