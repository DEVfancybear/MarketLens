import assert from "node:assert/strict";
import { test } from "node:test";

import { drawingPersistenceMetrics } from "../../src/components/chart/drawing/persistence/drawingPersistenceMetrics";

test("drawing persistence metrics expose content-free counters", () => {
  const before = drawingPersistenceMetrics.snapshot();
  drawingPersistenceMetrics.add("decodeFailures", 2);
  drawingPersistenceMetrics.add("conflicts");
  const after = drawingPersistenceMetrics.snapshot();
  assert.equal(after.decodeFailures, before.decodeFailures + 2);
  assert.equal(after.conflicts, before.conflicts + 1);
  assert.deepEqual(Object.keys(after).sort(), [
    "conflicts",
    "decodeFailures",
    "migrated",
    "quarantined",
    "retries",
  ]);
});
