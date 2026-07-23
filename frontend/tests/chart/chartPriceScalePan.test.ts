import assert from "node:assert/strict";
import { test } from "node:test";
import type { IChartApi } from "lightweight-charts";
import {
  beginPriceScalePan,
  resetPriceScalePan,
} from "../../src/components/chart/chartPriceScalePan";

function fakeChart() {
  const targets = [{ pane: 0 }, { pane: 1 }];
  const autoScale = [true, true];
  const chart = {
    panes: () => targets.map((target) => ({
      getHTMLElement: () => ({
        contains: (candidate: unknown) => candidate === target,
      }),
    })),
    priceScale: (_id: string, paneIndex: number) => ({
      setAutoScale: (on: boolean) => { autoScale[paneIndex] = on; },
    }),
  } as unknown as IChartApi;
  return { chart, targets, autoScale };
}

test("primary plot drag switches only its pane to manual price scale", () => {
  const { chart, targets, autoScale } = fakeChart();

  assert.equal(beginPriceScalePan(chart, {
    button: 0,
    isPrimary: true,
    pointerType: "mouse",
    target: targets[1] as unknown as EventTarget,
  }), 1);
  assert.deepEqual(autoScale, [true, false]);
});

test("secondary mouse input does not change price scale mode", () => {
  const { chart, targets, autoScale } = fakeChart();

  assert.equal(beginPriceScalePan(chart, {
    button: 2,
    isPrimary: true,
    pointerType: "mouse",
    target: targets[0] as unknown as EventTarget,
  }), null);
  assert.deepEqual(autoScale, [true, true]);
});

test("price scale reset restores autoscale for every pane", () => {
  const { chart, autoScale } = fakeChart();
  autoScale.fill(false);

  resetPriceScalePan(chart);
  assert.deepEqual(autoScale, [true, true]);
});
