import assert from "node:assert/strict";
import { test } from "node:test";

import { readSmcVisibleRange } from "../../src/components/smc/smcVisibleRange";

test("SMC visible range tolerates the lightweight-charts transient null assertion", () => {
  const timeScale = {
    getVisibleRange() {
      throw new Error("Value is null");
    },
  };

  assert.equal(readSmcVisibleRange(timeScale), null);
});

test("SMC visible range passes through a finite timestamp range", () => {
  const timeScale = {
    getVisibleRange: () => ({ from: 1_700_000_000, to: 1_700_003_600 }),
  };

  assert.deepEqual(readSmcVisibleRange(timeScale), {
    from: 1_700_000_000,
    to: 1_700_003_600,
  });
});

test("SMC visible range ignores unavailable or non-numeric ranges", () => {
  assert.equal(readSmcVisibleRange({ getVisibleRange: () => null }), null);
  assert.equal(
    readSmcVisibleRange({
      getVisibleRange: () => ({ from: Number.NaN, to: 1_700_003_600 }),
    }),
    null,
  );
});

test("SMC visible range does not hide unrelated chart API failures", () => {
  const failure = new Error("Chart API is disposed");

  assert.throws(
    () =>
      readSmcVisibleRange({
        getVisibleRange() {
          throw failure;
        },
      }),
    (error) => error === failure,
  );
});
