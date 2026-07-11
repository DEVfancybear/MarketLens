import assert from "node:assert/strict";
import { test } from "node:test";
import type { UTCTimestamp } from "lightweight-charts";
import { crosshairTimeToTimestamp } from "../../src/components/chart/crosshairSynchronization";

test("crosshair synchronization preserves intraday UTC timestamps", () => {
  assert.equal(
    crosshairTimeToTimestamp(1_704_067_200 as UTCTimestamp),
    1_704_067_200,
  );
});

test("crosshair synchronization normalizes business days and date strings", () => {
  assert.equal(
    crosshairTimeToTimestamp({ year: 2024, month: 1, day: 2 }),
    Date.UTC(2024, 0, 2) / 1000,
  );
  assert.equal(
    crosshairTimeToTimestamp("2024-01-02"),
    Date.UTC(2024, 0, 2) / 1000,
  );
});

test("crosshair synchronization rejects missing and invalid values", () => {
  assert.equal(crosshairTimeToTimestamp(null), null);
  assert.equal(crosshairTimeToTimestamp(undefined), null);
  assert.equal(crosshairTimeToTimestamp("not-a-date"), null);
});
