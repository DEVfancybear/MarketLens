import assert from "node:assert/strict";
import { test } from "node:test";

import { DrawingLoadGuard } from "../../src/components/chart/drawing/persistence/DrawingLoadGuard";

test("newer same-symbol and symbol-switch loads invalidate stale responses", () => {
  const guard = new DrawingLoadGuard();
  const first = guard.begin("EURUSD");
  const second = guard.begin("EURUSD");
  assert.equal(guard.isCurrent(first, "EURUSD"), false);
  assert.equal(guard.isCurrent(second, "EURUSD"), true);
  guard.cancel();
  assert.equal(guard.isCurrent(second, "EURUSD"), false);
  const third = guard.begin("BTCUSDT");
  assert.equal(guard.isCurrent(third, "EURUSD"), false);
  assert.equal(guard.isCurrent(third, "BTCUSDT"), true);
});
