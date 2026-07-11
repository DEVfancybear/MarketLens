import assert from "node:assert/strict";
import { test } from "node:test";

import { layoutPositionLabels } from "../../src/components/chart/drawing/tools/positionLabelLayout";

test("position label layout clamps to pane and resolves collisions deterministically", () => {
  const labels = layoutPositionLabels(
    [
      { id: "target", y: 12, height: 16 },
      { id: "entry", y: 14, height: 16 },
      { id: "stop", y: 95, height: 16 },
    ],
    2,
    100,
  );
  assert.deepEqual(labels.map(({ id, top }) => [id, top]), [
    ["target", 2],
    ["entry", 20],
    ["stop", 79],
  ]);
});
