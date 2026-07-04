import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle } from "../../src/types/market";
import {
  calendarCells,
  centeredLogicalRange,
  nearestCandleIndex,
  parseLocalDateTime,
  shortcutRange,
} from "../../src/components/chart/chartTimeNavigation";

function candles(count: number, start = 1000, step = 60): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const value = 10 + index;
    return {
      time: start + index * step,
      open: value,
      high: value + 1,
      low: value - 1,
      close: value,
      volume: 100,
    };
  });
}

test("range shortcuts anchor to the latest candle", () => {
  const data = candles(5, 1_000_000, 60);
  const oneDay = shortcutRange("1D", data);
  const fiveDays = shortcutRange("5D", data);

  assert.ok(oneDay && oneDay !== "all");
  assert.ok(fiveDays && fiveDays !== "all");
  assert.equal(oneDay.to, data.at(-1)!.time);
  assert.equal(oneDay.from, data.at(-1)!.time - 24 * 60 * 60);
  assert.equal(fiveDays.from, data.at(-1)!.time - 5 * 24 * 60 * 60);
});

test("all shortcut requests fitContent behavior", () => {
  assert.equal(shortcutRange("All", candles(3)), "all");
});

test("nearest candle search clamps and chooses the closest candle", () => {
  const data = candles(4, 1000, 60);

  assert.equal(nearestCandleIndex(data, 1000), 0);
  assert.equal(nearestCandleIndex(data, 1070), 1);
  assert.equal(nearestCandleIndex(data, 500), 0);
  assert.equal(nearestCandleIndex(data, 9999), 3);
});

test("go-to logical range preserves current zoom span", () => {
  assert.deepEqual(centeredLogicalRange(50, { from: 10, to: 30 }, 100), {
    from: 40,
    to: 60,
  });
  assert.deepEqual(centeredLogicalRange(5, null, 20), {
    from: -5,
    to: 15,
  });
});

test("local date time parser rejects incomplete drafts", () => {
  assert.equal(parseLocalDateTime("2026-07-04", "08:30") != null, true);
  assert.equal(parseLocalDateTime("2026-7-4", "08:30"), null);
  assert.equal(parseLocalDateTime("2026-07-04", "8:30"), null);
});

test("calendar grid always returns six weeks", () => {
  const cells = calendarCells(2026, 6);

  assert.equal(cells.length, 42);
  assert.equal(cells.some((cell) => cell.date === "2026-07-04"), true);
});
