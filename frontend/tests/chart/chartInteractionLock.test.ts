import assert from "node:assert/strict";
import test from "node:test";
import type { IChartApi } from "lightweight-charts";

import {
  chartInteractionLockCount,
  setChartInteractionLocked,
} from "../../src/components/chart/chartInteractionLock";

test("chart interaction stays frozen until every overlay owner releases it", () => {
  const baseline = {
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: false,
    },
    handleScale: {
      mouseWheel: false,
      pinch: true,
      axisPressedMouseMove: true,
      axisDoubleClickReset: true,
    },
  };
  const options: Array<unknown> = [];
  const chart = {
    options: () => baseline,
    applyOptions: (next: unknown) => options.push(next),
  } as unknown as IChartApi;

  setChartInteractionLocked(chart, "drawing", true);
  setChartInteractionLocked(chart, "replay", true);
  setChartInteractionLocked(chart, "drawing", false);

  assert.equal(chartInteractionLockCount(chart), 1);
  assert.equal(options.length, 1);
  assert.deepEqual(options.at(-1), { handleScroll: false, handleScale: false });

  setChartInteractionLocked(chart, "replay", false);
  assert.equal(chartInteractionLockCount(chart), 0);
  assert.deepEqual(options.at(-1), baseline);

  setChartInteractionLocked(chart, "missing-owner", false);
  assert.equal(options.length, 2);
});
