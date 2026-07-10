import test from "node:test";
import assert from "node:assert/strict";
import { resolveIndicatorSeriesWritePlan } from "../../src/services/indicatorSeriesWritePlan";

const point = (time: number, value = time, color?: string) => ({ time, value, color });

test("indicator write plan skips value-equal projections", () => {
  assert.equal(
    resolveIndicatorSeriesWritePlan([point(1), point(2)], [point(1), point(2)]),
    "none",
  );
});

test("indicator write plan updates only a changed latest point", () => {
  assert.equal(
    resolveIndicatorSeriesWritePlan([point(1), point(2)], [point(1), point(2, 20)]),
    "update-latest",
  );
  assert.equal(
    resolveIndicatorSeriesWritePlan(
      [point(1), point(2, 2, "red")],
      [point(1), point(2, 2, "green")],
    ),
    "update-latest",
  );
});

test("indicator write plan appends one point when the prefix is stable", () => {
  assert.equal(
    resolveIndicatorSeriesWritePlan([point(1), point(2)], [point(1), point(2), point(3)]),
    "append",
  );
});

test("indicator write plan replaces historical corrections and window changes", () => {
  assert.equal(
    resolveIndicatorSeriesWritePlan([point(1), point(2)], [point(1, 10), point(2)]),
    "replace",
  );
  assert.equal(
    resolveIndicatorSeriesWritePlan([point(1), point(2)], [point(2), point(3)]),
    "replace",
  );
});
