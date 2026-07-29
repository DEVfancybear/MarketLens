import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clampTextEditorPosition,
  resolveCenteredTextEditorPosition,
} from "../../src/components/chart/drawing/textEditorGeometry";

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

test("centered text editors stay anchored to drawing text instead of opening to its right", () => {
  assert.deepEqual(
    resolveCenteredTextEditorPosition({
      x: 200,
      y: 150,
      editorWidth: 160,
      editorHeight: 20,
      viewportWidth: 400,
      viewportHeight: 300,
    }),
    { x: 200, y: 150 },
  );
  assert.deepEqual(
    resolveCenteredTextEditorPosition({
      x: 200,
      y: 150,
      editorWidth: 160,
      editorHeight: 20,
      viewportWidth: 400,
      viewportHeight: 300,
      angleDegrees: 90,
      offsetY: -7,
    }),
    { x: 207, y: 150 },
  );
});

test("centered text editor clamps its rotated visual bounds", () => {
  const position = resolveCenteredTextEditorPosition({
    x: 398,
    y: 298,
    editorWidth: 160,
    editorHeight: 20,
    viewportWidth: 400,
    viewportHeight: 300,
    angleDegrees: 90,
  });
  assert.ok(position.x <= 386);
  assert.ok(position.y <= 216);
});
