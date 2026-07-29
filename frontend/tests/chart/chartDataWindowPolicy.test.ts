import assert from "node:assert/strict";
import test from "node:test";
import { isCandleDataWindowReset } from "../../src/components/chart/chartDataWindowPolicy";

const windowAt = (...times: number[]) => times.map((time) => ({ time }));

test("treats a market-series change as a reset even when candle timestamps overlap", () => {
  assert.equal(
    isCandleDataWindowReset({
      previous: windowAt(100, 200, 300),
      next: windowAt(100, 200, 300),
      structuralDataWindowChange: true,
      marketSeriesChanged: true,
    }),
    true,
  );
});

test("keeps an overlapping same-market history replacement in the current window", () => {
  assert.equal(
    isCandleDataWindowReset({
      previous: windowAt(200, 300),
      next: windowAt(100, 200, 300),
      structuralDataWindowChange: true,
      marketSeriesChanged: false,
    }),
    false,
  );
});

test("resets a disjoint replacement within the same market series", () => {
  assert.equal(
    isCandleDataWindowReset({
      previous: windowAt(100, 200),
      next: windowAt(400, 500),
      structuralDataWindowChange: true,
      marketSeriesChanged: false,
    }),
    true,
  );
});
