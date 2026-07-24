import assert from "node:assert/strict";
import { test } from "node:test";
import type { IChartApi, LogicalRange } from "lightweight-charts";
import { ChartViewportController } from "../../src/components/chart/chartViewportController";

function fakeChart(initial: LogicalRange = { from: 10, to: 40 } as LogicalRange) {
  let range: LogicalRange | null = initial;
  let handler: ((range: LogicalRange | null) => void) | null = null;
  let writes = 0;
  let resetCalls = 0;
  const timeScale = {
    getVisibleLogicalRange: () => range,
    subscribeVisibleLogicalRangeChange: (next: typeof handler) => { handler = next; },
    unsubscribeVisibleLogicalRangeChange: () => { handler = null; },
    setVisibleLogicalRange: (next: LogicalRange) => {
      writes += 1;
      range = next;
      handler?.(next);
    },
    setVisibleRange: () => { writes += 1; },
    fitContent: () => {
      writes += 1;
      range = { from: 0, to: 100 } as LogicalRange;
      handler?.(range);
    },
    applyOptions: () => {},
    resetTimeScale: () => { resetCalls += 1; },
    scrollToRealTime: () => { resetCalls += 1; },
  };
  const chart = {
    timeScale: () => timeScale,
    panes: () => [{ getHTMLElement: () => null }],
    priceScale: () => ({ setAutoScale: () => {} }),
  } as unknown as IChartApi;
  return {
    chart,
    emitUserRange(next: LogicalRange) {
      range = next;
      handler?.(next);
    },
    writes: () => writes,
    resetCalls: () => resetCalls,
  };
}

test("viewport controller skips value-equal programmatic ranges", () => {
  const fake = fakeChart();
  const controller = new ChartViewportController(fake.chart);

  assert.equal(
    controller.setLogicalRange({ from: 10, to: 40 } as LogicalRange, "time-navigation"),
    false,
  );
  assert.equal(fake.writes(), 0);
  assert.equal(controller.snapshot().programmaticWrites, 0);
  assert.equal(controller.snapshot().cause, "time-navigation");
  controller.destroy();
});

test("viewport controller attributes programmatic and user mutations", () => {
  const fake = fakeChart();
  const controller = new ChartViewportController(fake.chart);

  controller.setLogicalRange({ from: 20, to: 60 } as LogicalRange, "history-prepend");
  assert.equal(controller.snapshot().cause, "history-prepend");
  assert.equal(controller.snapshot().programmaticWrites, 1);

  controller.beginUserInteraction();
  fake.emitUserRange({ from: 21, to: 61 } as LogicalRange);
  assert.equal(controller.snapshot().cause, "user");
  assert.equal(controller.snapshot().programmaticWrites, 1);
  assert.equal(controller.snapshot().revision, 2);
  controller.destroy();
});

test("viewport controller drops a stale deferred range restore", () => {
  const fake = fakeChart();
  const controller = new ChartViewportController(fake.chart);
  const expectedRevision = controller.snapshot().revision;

  controller.setLogicalRange({ from: 80, to: 110 } as LogicalRange, "time-navigation");

  assert.equal(
    controller.setLogicalRangeIfRevision(
      { from: 10, to: 40 } as LogicalRange,
      "history-prepend",
      expectedRevision,
    ),
    false,
  );
  assert.equal(fake.writes(), 1);
  assert.equal(controller.snapshot().cause, "time-navigation");
  controller.destroy();
});

test("viewport controller applies a deferred range when its revision is current", () => {
  const fake = fakeChart();
  const controller = new ChartViewportController(fake.chart);
  const expectedRevision = controller.snapshot().revision;

  assert.equal(
    controller.setLogicalRangeIfRevision(
      { from: 20, to: 50 } as LogicalRange,
      "history-prepend",
      expectedRevision,
    ),
    true,
  );
  assert.equal(fake.writes(), 1);
  assert.equal(controller.snapshot().cause, "history-prepend");
  controller.destroy();
});

test("viewport reset is one controller transaction", () => {
  const fake = fakeChart();
  const controller = new ChartViewportController(fake.chart);
  controller.reset({ rightOffset: 8, barSpacing: 8, minBarSpacing: 1.5 });

  assert.equal(controller.snapshot().cause, "reset");
  assert.equal(controller.snapshot().programmaticWrites, 1);
  assert.equal(fake.resetCalls(), 2);
  controller.destroy();
});

test("market changes use the same latest-price reset without masquerading as a user reset", () => {
  const fake = fakeChart();
  const controller = new ChartViewportController(fake.chart);
  controller.reset(
    { rightOffset: 8, barSpacing: 8, minBarSpacing: 1.5 },
    "market-change",
  );

  assert.equal(controller.snapshot().cause, "market-change");
  assert.equal(controller.snapshot().programmaticWrites, 1);
  assert.equal(fake.resetCalls(), 2);
  controller.destroy();
});
