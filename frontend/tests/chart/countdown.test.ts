import assert from "node:assert/strict";
import test from "node:test";
import { formatCountdown } from "../../src/components/chart/countdownPresentation";

test("countdown formats intraday bars like TradingView", () => {
  assert.equal(formatCountdown(59), "0:59");
  assert.equal(formatCountdown(754), "12:34");
  assert.equal(formatCountdown(3600), "1:00:00");
  assert.equal(formatCountdown(14_706), "4:05:06");
});

test("countdown handles an unavailable boundary safely", () => {
  assert.equal(formatCountdown(0), "0:00");
  assert.equal(formatCountdown(Number.NaN), "0:00");
});
