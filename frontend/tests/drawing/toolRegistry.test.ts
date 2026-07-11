import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getTool,
  getToolDefinition,
  registerTool,
} from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/TrendLineTool";

test("an adapter registration produces a manifest-backed definition", () => {
  const definition = getToolDefinition("trendline");
  assert.ok(definition);
  assert.equal(definition.displayName, "Trendline");
  assert.equal(definition.creationMode, "two-point");
  assert.equal(definition.adapter, getTool("trendline"));
});

test("duplicate adapter ids fail loudly instead of silently replacing behavior", () => {
  const trendline = getTool("trendline");
  assert.ok(trendline);
  assert.throws(() => registerTool(trendline), /Duplicate drawing adapter registration/);
});
