import assert from "node:assert/strict";
import test from "node:test";
import { removeChartAfterCurrentStack } from "../../src/components/chart/chartLifecycle";

test("chart removal waits until the active chart call stack has unwound", async () => {
  let removeCalls = 0;

  removeChartAfterCurrentStack({
    remove: () => {
      removeCalls += 1;
    },
  });

  assert.equal(removeCalls, 0);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(removeCalls, 1);
});
