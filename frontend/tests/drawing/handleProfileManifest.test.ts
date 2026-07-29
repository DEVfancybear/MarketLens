import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DRAWING_TOOL_MANIFEST,
  type DrawingHandleProfile,
  type DrawingTool,
} from "../../src/types/drawingToolManifest";

const SPECIAL_HANDLE_PROFILES: Partial<Record<DrawingTool, DrawingHandleProfile>> = {
  vertical: "none",
  text: "none",
  brush: "endpoints",
  highlighter: "endpoints",
  long: "position-6",
  short: "position-6",
  rectangle: "rect-8",
  ellipse: "ellipse-axes-4",
  table: "table-grid",
  image: "corner-box-4",
};

test("manifest declares the shared handle topology for every drawing tool", () => {
  const persistentDefinitions = DRAWING_TOOL_MANIFEST.filter((definition) => definition.persistent);
  assert.ok(persistentDefinitions.length > 0);

  for (const definition of DRAWING_TOOL_MANIFEST) {
    const expectedProfile = definition.persistent
      ? SPECIAL_HANDLE_PROFILES[definition.id] ?? "raw-points"
      : "none";

    assert.ok(definition.handleProfile, `${definition.id} must declare a handle profile`);
    assert.equal(
      definition.handleProfile,
      expectedProfile,
      `${definition.id} must use the ${expectedProfile} handle profile`,
    );
  }
});
