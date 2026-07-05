import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FAVORITE_TIMEFRAMES,
  addFavoriteTimeframe,
  customIntervalToTimeframe,
  normalizeFavoriteTimeframes,
  toggleFavoriteTimeframe,
  visibleToolbarTimeframes,
} from "../../src/components/toolbar/timeframeSelectorModel";

test("timeframe selector defaults to TradingView-style favorites", () => {
  assert.deepEqual(DEFAULT_FAVORITE_TIMEFRAMES, ["1m", "5m", "15m"]);
});

test("timeframe favorites ignore unsupported or duplicated stored values", () => {
  assert.deepEqual(
    normalizeFavoriteTimeframes(["5m", "tick:1", "5m", "1D", "10m"]),
    ["5m", "1D"],
  );
});

test("favorite toggle keeps toolbar order by interval catalog", () => {
  assert.deepEqual(toggleFavoriteTimeframe(["15m", "1m"], "5m"), [
    "1m",
    "5m",
    "15m",
  ]);
  assert.deepEqual(toggleFavoriteTimeframe(["1m", "5m", "15m"], "5m"), [
    "1m",
    "15m",
  ]);
});

test("custom interval add keeps existing favorites and never toggles off", () => {
  assert.deepEqual(addFavoriteTimeframe(["1m", "15m"], "5m"), [
    "1m",
    "5m",
    "15m",
  ]);
  assert.deepEqual(addFavoriteTimeframe(["1m", "5m", "15m"], "5m"), [
    "1m",
    "5m",
    "15m",
  ]);
});

test("toolbar shows active interval even when it is not favorited", () => {
  assert.deepEqual(visibleToolbarTimeframes(["1m", "5m", "15m"], "1H"), [
    "1m",
    "5m",
    "15m",
    "1H",
  ]);
});

test("custom interval dialog maps supported values to chart timeframes", () => {
  assert.equal(customIntervalToTimeframe("minutes", "1"), "1m");
  assert.equal(customIntervalToTimeframe("minutes", "30"), "30m");
  assert.equal(customIntervalToTimeframe("hours", "2"), "2H");
  assert.equal(customIntervalToTimeframe("days", "1"), "1D");
  assert.equal(customIntervalToTimeframe("weeks", "1"), "1W");
  assert.equal(customIntervalToTimeframe("months", "1"), "1M");
});

test("custom interval dialog rejects unsupported values", () => {
  assert.equal(customIntervalToTimeframe("minutes", "10"), null);
  assert.equal(customIntervalToTimeframe("hours", "3"), null);
  assert.equal(customIntervalToTimeframe("range", "1"), null);
  assert.equal(customIntervalToTimeframe("minutes", "1.5"), null);
  assert.equal(customIntervalToTimeframe("minutes", ""), null);
});
