import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FAVORITE_TIMEFRAMES,
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

test("toolbar shows active interval even when it is not favorited", () => {
  assert.deepEqual(visibleToolbarTimeframes(["1m", "5m", "15m"], "1H"), [
    "1m",
    "5m",
    "15m",
    "1H",
  ]);
});
