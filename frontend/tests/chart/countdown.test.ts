import assert from "node:assert/strict";
import test from "node:test";
import type { Timeframe } from "../../src/types";
import {
  nextBarCloseTime,
  secondsUntilBarClose,
} from "../../src/components/chart/countdownModel";
import { formatCountdown } from "../../src/components/chart/countdownPresentation";

const utc = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
) => Date.UTC(year, month - 1, day, hour, minute, second) / 1000;

test("countdown formats intraday bars like TradingView", () => {
  assert.equal(formatCountdown(59), "0:59");
  assert.equal(formatCountdown(754), "12:34");
  assert.equal(formatCountdown(3600), "1:00:00");
  assert.equal(formatCountdown(14_706), "4:05:06");
  assert.equal(formatCountdown(86_400), "1d 00:00:00");
  assert.equal(formatCountdown(321_006), "3d 17:10:06");
});

test("countdown handles an unavailable boundary safely", () => {
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(Number.NaN), "0:00");
});

test("countdown aligns every supported timeframe to the current candle open", () => {
  const now = utc(2026, 7, 15, 6, 50);
  const cases: Array<{
    timeframe: Timeframe;
    barOpen: number;
    expected: number;
  }> = [
    { timeframe: "1m", barOpen: utc(2026, 7, 15, 6, 50), expected: 60 },
    { timeframe: "3m", barOpen: utc(2026, 7, 15, 6, 48), expected: 60 },
    { timeframe: "5m", barOpen: utc(2026, 7, 15, 6, 50), expected: 300 },
    { timeframe: "15m", barOpen: utc(2026, 7, 15, 6, 45), expected: 600 },
    { timeframe: "30m", barOpen: utc(2026, 7, 15, 6, 30), expected: 600 },
    { timeframe: "1H", barOpen: utc(2026, 7, 15, 6), expected: 600 },
    { timeframe: "2H", barOpen: utc(2026, 7, 15, 6), expected: 4_200 },
    { timeframe: "4H", barOpen: utc(2026, 7, 15, 4), expected: 4_200 },
    { timeframe: "1D", barOpen: utc(2026, 7, 15), expected: 61_800 },
    { timeframe: "1W", barOpen: utc(2026, 7, 12), expected: 321_000 },
    { timeframe: "1M", barOpen: utc(2026, 7, 1), expected: 1_444_200 },
  ];

  for (const { timeframe, barOpen, expected } of cases) {
    assert.equal(
      secondsUntilBarClose(timeframe, now, barOpen),
      expected,
      timeframe,
    );
  }
});

test("weekly countdown follows the broker candle instead of the Unix Thursday", () => {
  const barOpen = utc(2026, 7, 12);
  const now = utc(2026, 7, 15, 6, 50);

  assert.equal(nextBarCloseTime("1W", now, barOpen), utc(2026, 7, 19));
  assert.equal(formatCountdown(secondsUntilBarClose("1W", now, barOpen)), "3d 17:10:00");
});

test("monthly countdown uses real UTC calendar month lengths", () => {
  const leapMonthOpen = utc(2028, 2, 1);
  const regularMonthOpen = utc(2027, 2, 1);

  assert.equal(
    nextBarCloseTime("1M", utc(2028, 2, 28, 12), leapMonthOpen),
    utc(2028, 3, 1),
  );
  assert.equal(
    secondsUntilBarClose("1M", utc(2028, 2, 28, 12), leapMonthOpen),
    129_600,
  );
  assert.equal(
    secondsUntilBarClose("1M", utc(2027, 2, 28, 12), regularMonthOpen),
    43_200,
  );
});

test("a stale candle anchor does not invent countdowns through a closed session", () => {
  const staleOpen = utc(2026, 7, 15, 6, 47);
  const now = utc(2026, 7, 15, 6, 50, 30);

  assert.equal(nextBarCloseTime("1m", now, staleOpen), null);
  assert.equal(secondsUntilBarClose("1m", now, staleOpen), 0);
  assert.equal(secondsUntilBarClose("1m", Number.NaN, staleOpen), 0);
});

test("the last candle keeps its countdown only until its own close", () => {
  const barOpen = utc(2026, 7, 17, 20, 55);

  assert.equal(
    secondsUntilBarClose("5m", utc(2026, 7, 17, 20, 59, 34), barOpen),
    26,
  );
  assert.equal(nextBarCloseTime("5m", utc(2026, 7, 18, 12), barOpen), null);
});
