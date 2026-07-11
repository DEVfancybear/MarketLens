import assert from "node:assert/strict";
import { test } from "node:test";

import type { Candle } from "../../src/types/market";
import {
  calendarCells,
  canSelectGoToTime,
  centeredLogicalRange,
  firstCandleIndexAtOrAfter,
  formatDateInput,
  formatGoToMarkerLabel,
  formatTimeInput,
  formatUtcOffset,
  goToDateLogicalRange,
  goToDialogPosition,
  goToSelectionDraft,
  nearestCandleIndex,
  parseLocalDateTime,
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

test("nearest candle search clamps and chooses the closest candle", () => {
  const data = candles(4, 1000, 60);

  assert.equal(nearestCandleIndex(data, 1000), 0);
  assert.equal(nearestCandleIndex(data, 1070), 1);
  assert.equal(nearestCandleIndex(data, 500), 0);
  assert.equal(nearestCandleIndex(data, 9999), 3);
});

test("go-to date selects the first candle at or after the requested time", () => {
  const data = candles(4, 1000, 60);

  assert.equal(firstCandleIndexAtOrAfter(data, 1000), 0);
  assert.equal(firstCandleIndexAtOrAfter(data, 1001), 1);
  assert.equal(firstCandleIndexAtOrAfter(data, 1120), 2);
  assert.equal(firstCandleIndexAtOrAfter(data, 9999), 3);
  assert.equal(firstCandleIndexAtOrAfter([], 1000), null);
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

test("go-to date zooms in when the current chart is too wide", () => {
  assert.deepEqual(goToDateLogicalRange(50, { from: 0, to: 180 }), {
    from: 35.72,
    to: 69.72,
  });
});

test("go-to date keeps an already close zoom span", () => {
  assert.deepEqual(goToDateLogicalRange(50, { from: 44, to: 64 }), {
    from: 41.6,
    to: 61.6,
  });
});

test("local date time parser rejects incomplete drafts", () => {
  assert.equal(parseLocalDateTime("2026-07-04", "08:30") != null, true);
  assert.equal(parseLocalDateTime("2026-7-4", "08:30"), null);
  assert.equal(parseLocalDateTime("2026-07-04", "8:30"), null);
});

test("date time parser supports selected chart time zones", () => {
  assert.equal(
    parseLocalDateTime("2026-07-01", "00:00", "UTC"),
    Date.UTC(2026, 6, 1, 0, 0, 0, 0) / 1000,
  );
  assert.equal(
    parseLocalDateTime("2026-07-01", "00:00", "America/New_York"),
    Date.UTC(2026, 6, 1, 4, 0, 0, 0) / 1000,
  );
});

test("date time formatting follows the selected chart time zone", () => {
  const timeMs = Date.UTC(2026, 6, 1, 4, 0, 0, 0);

  assert.equal(formatDateInput(timeMs, "America/New_York"), "2026-07-01");
  assert.equal(formatTimeInput(timeMs, "America/New_York"), "00:00");
  assert.equal(formatUtcOffset(new Date(timeMs), "America/New_York"), "UTC-4");
  assert.equal(formatUtcOffset(new Date(timeMs), "UTC"), "UTC");
});

test("go-to selection draft restores the last applied date and range", () => {
  const selected = parseLocalDateTime(
    "2026-07-02",
    "00:00",
    "Asia/Ho_Chi_Minh",
  );
  assert.notEqual(selected, null);
  assert.deepEqual(
    goToSelectionDraft(
      { tab: "date", time: selected! },
      "Asia/Ho_Chi_Minh",
    ),
    { tab: "date", singleDate: "2026-07-02", singleTime: "00:00" },
  );

  assert.deepEqual(
    goToSelectionDraft(
      { tab: "range", from: selected!, to: selected! + 3600 },
      "Asia/Ho_Chi_Minh",
    ),
    {
      tab: "range",
      fromDate: "2026-07-02",
      fromTime: "00:00",
      toDate: "2026-07-02",
      toTime: "01:00",
    },
  );
});

test("specific Go-to time follows backend timeframe capabilities", () => {
  const allowed = ["1m", "5m", "1H", "2H"];
  assert.equal(canSelectGoToTime("1m", allowed), true);
  assert.equal(canSelectGoToTime("2H", allowed), true);
  assert.equal(canSelectGoToTime("4H", allowed), false);
  assert.equal(canSelectGoToTime("1D", allowed), false);
});

test("calendar grid always returns six weeks", () => {
  const cells = calendarCells(2026, 6);

  assert.equal(cells.length, 42);
  assert.equal(cells.some((cell) => cell.date === "2026-07-04"), true);
});

test("go-to marker label matches TradingView-style date chip", () => {
  const time = new Date(2026, 6, 1, 0, 0, 0, 0).getTime() / 1000;

  assert.equal(formatGoToMarkerLabel(time), "Wed 01 Jul '26\n00:00");
});

test("go-to marker label can render in selected time zone", () => {
  const time = Date.UTC(2026, 6, 1, 4, 0, 0, 0) / 1000;

  assert.equal(
    formatGoToMarkerLabel(time, "America/New_York"),
    "Wed 01 Jul '26\n00:00",
  );
});

test("go-to dialog opens near its toolbar button and clamps to the viewport", () => {
  assert.deepEqual(
    goToDialogPosition(
      { left: 260, top: 520, right: 292, bottom: 548 },
      { width: 1280, height: 720 },
      { width: 302, height: 478 },
    ),
    { left: 252, top: 34 },
  );

  assert.deepEqual(
    goToDialogPosition(
      { left: 1240, top: 690, right: 1272, bottom: 718 },
      { width: 1280, height: 720 },
      { width: 302, height: 478 },
    ),
    { left: 970, top: 204 },
  );
});
