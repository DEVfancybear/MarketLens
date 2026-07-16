import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pressureSegmentWidths,
  pressureStrokeWidth,
} from "../../src/components/chart/drawing/tools/plugins/BrushTool";

test("mouse/touch brush points preserve the configured width", () => {
  assert.equal(pressureStrokeWidth(4), 4);
  assert.deepEqual(
    pressureSegmentWidths(
      [
        { time: 1, price: 1 },
        { time: 2, price: 2 },
        { time: 3, price: 3 },
      ],
      4,
    ),
    [4, 4],
  );
});

test("pen pressure creates a bounded monotonic variable-width envelope", () => {
  const widths = pressureSegmentWidths(
    [
      { time: 1, price: 1, pressure: 0 },
      { time: 2, price: 2, pressure: 0.5 },
      { time: 3, price: 3, pressure: 1 },
    ],
    10,
  );
  assert.equal(widths.length, 2);
  assert.ok(widths[0] < widths[1]);
  assert.equal(pressureStrokeWidth(10, 0), 3.5);
  assert.equal(pressureStrokeWidth(10, 1), 12.5);
  assert.equal(pressureStrokeWidth(10, -4), 3.5);
  assert.equal(pressureStrokeWidth(10, 4), 12.5);
});
