import assert from "node:assert/strict";
import test from "node:test";
import { sortWatchlistSymbols } from "../../src/store/watchlistSort";
import type { MarketQuote } from "../../src/types";

const entries = ["AAA", "BBB", "CCC"].map((ticker, index) => ({ ticker, index }));
const quotes: Record<string, MarketQuote> = {
  AAA: { symbol: "AAA", last: 2, change: 1, changePct: 5, volume: 20, timestamp: 1 },
  CCC: { symbol: "CCC", last: 1, change: -1, changePct: -5, volume: 10, timestamp: 1 },
};

test("shared watchlist sorting keeps missing quotes last in both directions", () => {
  assert.deepEqual(
    sortWatchlistSymbols(entries, "price", "asc", quotes).map((entry) => entry.ticker),
    ["CCC", "AAA", "BBB"],
  );
  assert.deepEqual(
    sortWatchlistSymbols(entries, "price", "desc", quotes).map((entry) => entry.ticker),
    ["AAA", "CCC", "BBB"],
  );
});

test("shared watchlist sorting preserves source order for equal values", () => {
  const equalQuotes = {
    ...quotes,
    BBB: { symbol: "BBB", last: 2, change: 1, changePct: 5, volume: 20, timestamp: 1 },
  };
  assert.deepEqual(
    sortWatchlistSymbols(entries, "change", "desc", equalQuotes).map((entry) => entry.ticker),
    ["AAA", "BBB", "CCC"],
  );
});
