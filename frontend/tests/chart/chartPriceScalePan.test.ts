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
  const visibleRanges = [
    { from: 10, to: 20 },
    { from: 100, to: 140 },
  ];
  const visibleRangeWrites = [0, 0];
  const paneRects = [
    { left: 0, right: 300, top: 0, bottom: 200, width: 300, height: 200 },
    { left: 0, right: 300, top: 200, bottom: 400, width: 300, height: 200 },
  ];
  const chart = {
    panes: () => targets.map((target, paneIndex) => ({
      getHTMLElement: () => ({
        contains: (candidate: unknown) => candidate === target,
        getBoundingClientRect: () => paneRects[paneIndex],
      }),
      getHeight: () => paneRects[paneIndex].height,
    })),
    priceScale: (_id: string, paneIndex: number) => ({
      setAutoScale: (on: boolean) => { autoScale[paneIndex] = on; },
      width: () => 74,
      getVisibleRange: () => ({ ...visibleRanges[paneIndex] }),
      setVisibleRange: (range: { from: number; to: number }) => {
        visibleRanges[paneIndex] = { ...range };
        visibleRangeWrites[paneIndex] += 1;
      },
    }),
  } as unknown as IChartApi;
  return {
    chart,
    targets,
    autoScale,
    visibleRanges,
    visibleRangeWrites,
  };
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

test("dragging the right price axis scales around the initial range center", () => {
  const {
    chart,
    targets,
    autoScale,
    visibleRanges,
    visibleRangeWrites,
  } = fakeChart();
  const initial = { ...visibleRanges[0] };

  beginPriceScalePan(chart, {
    button: 0,
    clientX: 290,
    clientY: 100,
    isPrimary: true,
    pointerId: 11,
    pointerType: "mouse",
    target: targets[0] as unknown as EventTarget,
  });
  assert.equal(continuePriceScalePan(chart, {
    buttons: 1,
    clientX: 290,
    clientY: 70,
    isPrimary: true,
    pointerId: 11,
  }), 0);

  assert.equal(autoScale[0], false);
  assert.equal(visibleRangeWrites[0], 1);
  assert.equal(
    (visibleRanges[0].from + visibleRanges[0].to) / 2,
    (initial.from + initial.to) / 2,
  );
  assert.ok(
    visibleRanges[0].to - visibleRanges[0].from <
      initial.to - initial.from,
  );
});

test("cancelled and repeated price-axis drags cannot strand the next gesture", () => {
  const {
    chart,
    targets,
    visibleRanges,
    visibleRangeWrites,
  } = fakeChart();

  beginPriceScalePan(chart, {
    button: 0,
    clientX: 290,
    clientY: 100,
    isPrimary: true,
    pointerId: 20,
    pointerType: "mouse",
    target: targets[0] as unknown as EventTarget,
  });
  assert.equal(continuePriceScalePan(chart, {
    buttons: 0,
    clientX: 290,
    clientY: 80,
    isPrimary: true,
    pointerId: 20,
  }), null);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pointerId = 30 + attempt;
    const startY = attempt % 2 === 0 ? 100 : 88;
    const endY = attempt % 2 === 0 ? 88 : 100;
    const before = { ...visibleRanges[0] };
    beginPriceScalePan(chart, {
      button: 0,
      clientX: 290,
      clientY: startY,
      isPrimary: true,
      pointerId,
      pointerType: "mouse",
      target: targets[0] as unknown as EventTarget,
    });
    assert.equal(continuePriceScalePan(chart, {
      buttons: 1,
      clientX: 290,
      clientY: endY,
      isPrimary: true,
      pointerId,
    }), 0);
    endPriceScalePan(chart, { pointerId });
    assert.notDeepEqual(visibleRanges[0], before);
  }

  assert.equal(visibleRangeWrites[0], 20);
});

test("price scale reset restores autoscale for every pane", () => {
  const { chart, autoScale } = fakeChart();
  autoScale.fill(false);

  resetPriceScalePan(chart);
  assert.deepEqual(autoScale, [true, true]);
});
