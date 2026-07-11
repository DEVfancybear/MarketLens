import assert from "node:assert/strict";
import { test } from "node:test";

import { subscribeChartViewportEvents } from "../../src/components/chart/chartViewportEvents";

class FakeTimeScale {
  range?: () => void;
  size?: () => void;
  subscribeVisibleLogicalRangeChange(callback: () => void) {
    this.range = callback;
  }
  unsubscribeVisibleLogicalRangeChange(callback: () => void) {
    if (this.range === callback) this.range = undefined;
  }
  subscribeSizeChange(callback: () => void) {
    this.size = callback;
  }
  unsubscribeSizeChange(callback: () => void) {
    if (this.size === callback) this.size = undefined;
  }
}

class FakePointerEvent extends Event {
  constructor(type: string, readonly buttons: number) {
    super(type);
  }
}

test("shared viewport contract observes range, size, wheel, and active pointers", () => {
  const root = new EventTarget();
  const timeScale = new FakeTimeScale();
  const sources: string[] = [];
  const chartElement = { parentElement: root };
  const chart = {
    timeScale: () => timeScale,
    chartElement: () => chartElement,
  };

  const unsubscribe = subscribeChartViewportEvents(
    chart as never,
    (source) => sources.push(source),
  );

  timeScale.range?.();
  timeScale.size?.();
  root.dispatchEvent(new Event("wheel"));
  root.dispatchEvent(new FakePointerEvent("pointermove", 0));
  root.dispatchEvent(new FakePointerEvent("pointermove", 1));

  assert.deepEqual(sources, ["range", "size", "input", "input"]);

  unsubscribe();
  timeScale.range?.();
  timeScale.size?.();
  root.dispatchEvent(new Event("wheel"));
  assert.deepEqual(sources, ["range", "size", "input", "input"]);
});
