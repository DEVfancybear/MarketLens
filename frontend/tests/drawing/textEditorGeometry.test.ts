import assert from "node:assert/strict";
import { test } from "node:test";

import { clampTextEditorPosition } from "../../src/components/chart/drawing/textEditorGeometry";

test("inline text editor stays fully inside its chart-local viewport", () => {
  assert.deepEqual(
    clampTextEditorPosition({
      left: 395,
      top: 295,
      editorWidth: 120,
      editorHeight: 24,
      viewportWidth: 400,
      viewportHeight: 300,
    }),
    { left: 276, top: 272 },
  );
  assert.deepEqual(
    clampTextEditorPosition({
      left: -50,
      top: -20,
      editorWidth: 120,
      editorHeight: 24,
      viewportWidth: 400,
      viewportHeight: 300,
    }),
    { left: 4, top: 4 },
  );
});
