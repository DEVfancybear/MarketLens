import assert from "node:assert/strict";
import { test } from "node:test";
import type { IChartApi } from "lightweight-charts";
import {
  beginPriceScalePan,
  continuePriceScalePan,
  endPriceScalePan,
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

test("a plain primary click keeps auto-scale enabled", () => {
  const { chart, targets, autoScale } = fakeChart();

  assert.equal(beginPriceScalePan(chart, {
    button: 0,
    clientX: 100,
    clientY: 100,
    isPrimary: true,
    pointerId: 7,
    pointerType: "mouse",
    target: targets[1] as unknown as EventTarget,
  }), 1);
  endPriceScalePan(chart, { pointerId: 7 });
  assert.deepEqual(autoScale, [true, true]);
});

test("the first real plot drag switches only its pane to manual price scale", () => {
  const { chart, targets, autoScale } = fakeChart();

  beginPriceScalePan(chart, {
    button: 0,
    clientX: 100,
    clientY: 100,
    isPrimary: true,
    pointerId: 7,
    pointerType: "mouse",
    target: targets[1] as unknown as EventTarget,
  });
  assert.equal(continuePriceScalePan(chart, {
    buttons: 1,
    clientX: 100,
    clientY: 104,
    isPrimary: true,
    pointerId: 7,
  }), 1);
  assert.deepEqual(autoScale, [true, false]);
});

test("secondary mouse input does not change price scale mode", () => {
  const { chart, targets, autoScale } = fakeChart();

  assert.equal(beginPriceScalePan(chart, {
    button: 2,
    clientX: 100,
    clientY: 100,
    isPrimary: true,
    pointerId: 7,
    pointerType: "mouse",
    target: targets[0] as unknown as EventTarget,
  }), null);
  assert.deepEqual(autoScale, [true, true]);
});

test("a missed release is recovered from a move with no pressed button", () => {
  const { chart, targets, autoScale } = fakeChart();
  beginPriceScalePan(chart, {
    button: 0,
    clientX: 10,
    clientY: 10,
    isPrimary: true,
    pointerId: 3,
    pointerType: "mouse",
    target: targets[0] as unknown as EventTarget,
  });

  assert.equal(continuePriceScalePan(chart, {
    buttons: 0,
    clientX: 20,
    clientY: 20,
    isPrimary: true,
    pointerId: 3,
  }), null);
  assert.deepEqual(autoScale, [true, true]);
});

test("price scale reset restores autoscale for every pane", () => {
  const { chart, autoScale } = fakeChart();
  autoScale.fill(false);

  resetPriceScalePan(chart);
  assert.deepEqual(autoScale, [true, true]);
});
