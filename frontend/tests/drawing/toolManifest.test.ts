import assert from "node:assert/strict";
import { test } from "node:test";

import { ALL_DRAWING_TOOL_IDS } from "../../src/types/drawing";
import {
  DRAWING_TOOLS,
  DRAWING_TOOL_GROUPS,
  DRAWING_TOOL_MANIFEST,
  MODE_TOOLS,
  getDrawingToolManifestEntry,
  isDrawingToolCreationEnabled,
  normalizeFavoriteDrawingTools,
  styleFamily,
} from "../../src/types/drawingToolManifest";

test("manifest has exactly one complete definition for every stable tool id", () => {
  assert.equal(DRAWING_TOOL_MANIFEST.length, ALL_DRAWING_TOOL_IDS.length);
  assert.equal(new Set(DRAWING_TOOL_MANIFEST.map((entry) => entry.id)).size, ALL_DRAWING_TOOL_IDS.length);
  assert.deepEqual(
    [...DRAWING_TOOLS, ...MODE_TOOLS].sort(),
    [...ALL_DRAWING_TOOL_IDS].sort(),
  );
  for (const id of ALL_DRAWING_TOOL_IDS) {
    assert.equal(getDrawingToolManifestEntry(id).id, id);
  }
});

test("toolbar groups and defaults reference manifest entries", () => {
  for (const group of DRAWING_TOOL_GROUPS) {
    const entries = DRAWING_TOOL_MANIFEST.filter((entry) => entry.group === group.id);
    assert.ok(entries.length > 0, `${group.id} must contain tools`);
    assert.ok(entries.some((entry) => entry.id === group.defaultTool));
  }
  assert.equal(getDrawingToolManifestEntry("fib").preferredForCreation, false);
  assert.equal(getDrawingToolManifestEntry("fibRetracement").preferredForCreation, true);
});

test("creation and style families are derived from the manifest", () => {
  assert.equal(getDrawingToolManifestEntry("brush").creationMode, "pointer-continuous");
  assert.equal(getDrawingToolManifestEntry("path").creationMode, "click-freeform");
  assert.equal(getDrawingToolManifestEntry("triangle").maxPoints, 3);
  assert.equal(getDrawingToolManifestEntry("trendline").defaultProperties.lineWidth, 1.5);
  assert.equal(styleFamily("rectangle"), "shape");
  assert.equal(styleFamily("emoji"), "text");
  assert.equal(styleFamily("trendline"), "line");
  assert.equal(getDrawingToolManifestEntry("text").overlayExtension, "text-editor");
  assert.equal(getDrawingToolManifestEntry("trendline").selectionTextEditor, "line-midpoint");
  assert.equal(getDrawingToolManifestEntry("trendline").angleConstraint, "45-degree");
  assert.equal(getDrawingToolManifestEntry("channel").selectionTextEditor, "line-midpoint");
  assert.equal(getDrawingToolManifestEntry("brush").pointSimplificationTolerance, 0.75);
  assert.equal(getDrawingToolManifestEntry("rectangle").selectionTextEditor, "shape-center");
  assert.equal(getDrawingToolManifestEntry("long").settingsOverlay, "position-dialog");
  assert.equal(getDrawingToolManifestEntry("short").lifecycleExtension, "position-resolution");
  assert.equal(getDrawingToolManifestEntry("cursor").modeInteraction, "selection");
  assert.equal(getDrawingToolManifestEntry("eraser").modeInteraction, "erase");
  assert.equal(getDrawingToolManifestEntry("crosshair").modeInteraction, "pass-through");
  assert.equal(getDrawingToolManifestEntry("trendline").magnetEligible, true);
  assert.equal(getDrawingToolManifestEntry("text").magnetEligible, true);
  assert.equal(getDrawingToolManifestEntry("brush").magnetEligible, false);
  for (const definition of DRAWING_TOOL_MANIFEST.filter((entry) => entry.persistent)) {
    assert.equal(
      definition.magnetEligible,
      definition.creationMode !== "pointer-continuous",
      `${definition.id} magnet eligibility must follow its creation capability`,
    );
    assert.equal(
      definition.settingsFeatures.includes("coordinates"),
      true,
      `${definition.id} must expose precise coordinates`,
    );
  }
});

test("favorite validation rejects unknown and ineligible ids and keeps order", () => {
  assert.deepEqual(
    normalizeFavoriteDrawingTools(["trendline", "unknown", "measure", "trendline", "cursor"]),
    ["trendline", "cursor"],
  );
});

test("Wave A rollout disables creation without removing manifest compatibility", () => {
  assert.equal(isDrawingToolCreationEnabled("datePriceRange", false), false);
  assert.equal(isDrawingToolCreationEnabled("note", false), false);
  assert.equal(isDrawingToolCreationEnabled("trendline", false), true);
  assert.equal(getDrawingToolManifestEntry("datePriceRange").persistent, true);
});
