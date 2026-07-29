import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { fibSpiralSamples } from "../../src/components/chart/drawing/tools/plugins/FibSpiralTool";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/adapters";
import {
  DRAWING_TOOL_MANIFEST,
  getDrawingToolManifestEntry,
} from "../../src/types/drawingToolManifest";

const CURSORS = [
  "crosshair",
  "dotCursor",
  "cursor",
  "demonstrationCursor",
  "magicCursor",
  "eraser",
] as const;

const FIBONACCI_AND_GANN = [
  "fibRetracement",
  "fibExtension",
  "fibTimeZone",
  "fibChannel",
  "fibSpeedFan",
  "trendFibTime",
  "fibCircles",
  "fibSpiral",
  "fibSpeedArcs",
  "fibWedge",
  "pitchfan",
  "gannFan",
  "gannSquare",
  "gannBox",
] as const;

const GEOMETRIC_SHAPES = [
  "brush",
  "highlighter",
  "arrow",
  "arrowMarker",
  "arrowMarkUp",
  "arrowMarkDown",
  "rectangle",
  "rotatedRect",
  "path",
  "circle",
  "ellipse",
  "polyline",
  "triangle",
  "arc",
  "curve",
  "doubleCurve",
] as const;

const ANNOTATIONS = [
  "text",
  "note",
  "priceNote",
  "pin",
  "table",
  "callout",
  "comment",
  "priceLabel",
  "signpost",
  "flag",
  "image",
  "socialEmbed",
] as const;

function creatableIds(group: "cursor" | "fibonacci" | "shapes" | "annotations") {
  return DRAWING_TOOL_MANIFEST
    .filter((entry) =>
      entry.group === group
      && (group === "cursor" || entry.preferredForCreation),
    )
    .map((entry) => entry.id);
}

test("requested TradingView groups expose every researched tool in official order", () => {
  assert.deepEqual(creatableIds("cursor"), [...CURSORS]);
  assert.deepEqual(creatableIds("fibonacci"), [...FIBONACCI_AND_GANN]);
  assert.deepEqual(creatableIds("shapes"), [...GEOMETRIC_SHAPES]);
  assert.deepEqual(creatableIds("annotations"), [...ANNOTATIONS]);
});

test("every requested persistent tool has its own registered production adapter", () => {
  for (const tool of [
    ...FIBONACCI_AND_GANN,
    ...GEOMETRIC_SHAPES,
    ...ANNOTATIONS,
  ]) {
    const definition = getDrawingToolManifestEntry(tool);
    assert.equal(definition.persistent, true, `${tool}: persistent`);
    assert.equal(getTool(tool)?.tool, tool, `${tool}: adapter`);
  }
});

test("researched point counts and special interactions remain explicit", () => {
  const expectedPoints = {
    fibRetracement: 2,
    fibExtension: 3,
    fibTimeZone: 2,
    fibChannel: 3,
    fibSpeedFan: 2,
    trendFibTime: 3,
    fibCircles: 2,
    fibSpiral: 2,
    fibSpeedArcs: 2,
    fibWedge: 2,
    pitchfan: 3,
    gannFan: 2,
    gannSquare: 2,
    gannBox: 2,
    rotatedRect: 3,
    triangle: 3,
    arc: 3,
    doubleCurve: 4,
    priceNote: 2,
    pin: 1,
  } as const;

  for (const [tool, points] of Object.entries(expectedPoints)) {
    const definition = getDrawingToolManifestEntry(
      tool as keyof typeof expectedPoints,
    );
    assert.equal(
      definition.maxPoints ?? definition.minPoints,
      points,
      `${tool}: anchor count`,
    );
  }

  assert.equal(getDrawingToolManifestEntry("polyline").freeformCloseOnFirstPoint, true);
  assert.equal(getDrawingToolManifestEntry("demonstrationCursor").modeInteraction, "demonstration");
  assert.equal(getDrawingToolManifestEntry("priceNote").angleConstraint, "45-degree");
  assert.equal(getDrawingToolManifestEntry("fibWedge").creationMode, "two-point");
});

test("compatibility-only tools stay loadable but out of the current official menus", () => {
  for (const tool of ["fib", "arrowMarkLeft", "arrowMarkRight"] as const) {
    assert.equal(getDrawingToolManifestEntry(tool).preferredForCreation, false);
    assert.ok(getTool(tool), `${tool}: legacy documents remain renderable`);
  }
  assert.equal(getDrawingToolManifestEntry("emoji").group, "icons");
  for (const tool of [
    "pitchfork",
    "insidePitchfork",
    "schiffPitchfork",
    "modifiedSchiffPitchfork",
  ] as const) {
    assert.equal(getDrawingToolManifestEntry(tool).group, "lines");
  }
});

test("Fib Spiral fixes its outer anchor and reverse changes chirality", () => {
  const center = { x: 100, y: 100 };
  const edge = { x: 200, y: 100 };
  const normal = fibSpiralSamples(center, edge);
  const reversed = fibSpiralSamples(center, edge, true);

  assert.equal(normal.length, 161);
  assert.deepEqual(normal.at(-1), edge);
  assert.deepEqual(reversed.at(-1), edge);
  assert.ok(Math.abs(normal[120].x - reversed[120].x) < 1e-9);
  assert.ok(Math.abs(normal[120].y + reversed[120].y - center.y * 2) < 1e-9);
});

test("closed Polyline and filled Arc expose the same visible interior to hit testing", () => {
  const base = {
    id: "requested-shape",
    color: "#2962ff",
    lineWidth: 2,
    fillColor: "#2962ff",
    opacity: 0.2,
  } satisfies Partial<Drawing>;
  const identity = (value: number) => value;
  const polyline: Drawing = {
    ...base,
    id: "requested-polyline",
    tool: "polyline",
    points: [
      { time: 0, price: 0 },
      { time: 100, price: 0 },
      { time: 100, price: 100 },
      { time: 0, price: 100 },
      { time: 0, price: 0 },
    ],
  } as Drawing;
  const arc: Drawing = {
    ...base,
    id: "requested-arc",
    tool: "arc",
    points: [
      { time: 0, price: 100 },
      { time: 100, price: 100 },
      { time: 50, price: 0 },
    ],
  } as Drawing;

  assert.ok(getTool("polyline")!.hitTest(polyline, 50, 50, identity, identity).length > 0);
  assert.ok(getTool("arc")!.hitTest(arc, 50, 75, identity, identity).length > 0);
});
