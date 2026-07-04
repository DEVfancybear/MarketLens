import assert from "node:assert/strict";
import { test } from "node:test";

import { clampDialogPosition } from "../../src/hooks/useDraggableDialog";

test("dialog positions stay inside the viewport margin", () => {
  assert.deepEqual(
    clampDialogPosition(
      { left: -50, top: -20 },
      { width: 300, height: 200 },
      { width: 1000, height: 800 },
      8,
    ),
    { left: 8, top: 8 },
  );

  assert.deepEqual(
    clampDialogPosition(
      { left: 900, top: 760 },
      { width: 300, height: 200 },
      { width: 1000, height: 800 },
      8,
    ),
    { left: 692, top: 592 },
  );
});

test("large dialogs remain reachable when they are wider than the viewport", () => {
  assert.deepEqual(
    clampDialogPosition(
      { left: 240, top: 120 },
      { width: 900, height: 700 },
      { width: 600, height: 500 },
      12,
    ),
    { left: 12, top: 12 },
  );
});
