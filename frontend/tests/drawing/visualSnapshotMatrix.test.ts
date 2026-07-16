import assert from "node:assert/strict";
import { test } from "node:test";

import "../../src/components/chart/drawing/tools/adapters";
import { allTools } from "../../src/components/chart/drawing/tools/ToolRegistry";
import { drawingFixture } from "../../src/components/chart/drawing/testing/toolFixtures";
import {
  DRAWING_TOOL_MANIFEST,
  isDrawingToolCreationEnabled,
} from "../../src/types/drawingToolManifest";
import { DRAWING_TOOLS } from "../../src/types/drawing";
import {
  DRAWING_BROWSER_SNAPSHOT_CASES,
  DRAWING_CONTRACT_ONLY_SNAPSHOT_CASES,
  DRAWING_VISUAL_SNAPSHOT_MATRIX,
  matrixFixturePointCount,
} from "./visualSnapshotMatrix";

test("visual matrix is complete, deterministic, and manifest-derived", () => {
  const persistentManifest = DRAWING_TOOL_MANIFEST.filter((entry) => entry.persistent);
  assert.deepEqual(
    DRAWING_VISUAL_SNAPSHOT_MATRIX.map((item) => item.id),
    persistentManifest.map((entry) => entry.id),
    "matrix order must follow manifest order",
  );
  assert.deepEqual(
    DRAWING_VISUAL_SNAPSHOT_MATRIX.map((item) => item.id).sort(),
    [...DRAWING_TOOLS].sort(),
    "every persistent adapter must have one visual row",
  );

  const screenshotNames = DRAWING_VISUAL_SNAPSHOT_MATRIX.map((item) => item.screenshotName);
  assert.equal(new Set(screenshotNames).size, screenshotNames.length);
  for (const item of DRAWING_VISUAL_SNAPSHOT_MATRIX) {
    const definition = persistentManifest.find((entry) => entry.id === item.id);
    assert.ok(definition);
    assert.equal(item.pointCount, matrixFixturePointCount(definition));
    assert.ok(item.visualContract.includes("body"));
    assert.ok(item.screenshotName.endsWith(".png"));
    if (item.coverage === "browser") {
      assert.ok(item.group, `${item.id}: browser rows need a toolbar group`);
      assert.ok(item.groupLabel, `${item.id}: browser rows need a group label`);
      assert.equal(definition.preferredForCreation, true);
      assert.equal(isDrawingToolCreationEnabled(item.id), true);
    } else {
      assert.ok(
        !definition.preferredForCreation ||
          !definition.group ||
          !isDrawingToolCreationEnabled(item.id),
        `${item.id}: contract-only row must be hidden or ungrouped`,
      );
    }
  }
  assert.equal(
    DRAWING_BROWSER_SNAPSHOT_CASES.length + DRAWING_CONTRACT_ONLY_SNAPSHOT_CASES.length,
    DRAWING_VISUAL_SNAPSHOT_MATRIX.length,
  );
});

test("visual matrix fixtures remain aligned with production adapters", () => {
  const adapters = new Map(allTools().map((adapter) => [adapter.tool, adapter]));
  for (const item of DRAWING_VISUAL_SNAPSHOT_MATRIX) {
    const adapter = adapters.get(item.id);
    assert.ok(adapter, `${item.id}: adapter`);
    const fixture = drawingFixture(item.id, adapter);
    assert.equal(fixture.points.length, item.pointCount, `${item.id}: fixture point count`);
    assert.ok(
      fixture.points.every((point) => Number.isFinite(point.time) && Number.isFinite(point.price)),
      `${item.id}: finite fixture coordinates`,
    );
  }
});
