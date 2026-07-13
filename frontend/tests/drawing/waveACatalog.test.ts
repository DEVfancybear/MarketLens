import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/RangeTools";
import "../../src/components/chart/drawing/tools/plugins/ChannelVariantsTool";
import "../../src/components/chart/drawing/tools/plugins/AnnotationTools";
import "../../src/components/chart/drawing/tools/plugins/TimeProjectionTools";

const WAVE_A = [
  "priceRange", "dateRange", "datePriceRange", "flatTopBottom", "disjointChannel",
  "note", "callout", "comment", "priceLabel", "signpost", "flag",
  "cyclicLines", "fibTimeZone",
] as const;

function fixture(tool: Drawing["tool"]): Drawing {
  return {
    id: `wave-a-${tool}`, tool, color: "#2962ff", lineWidth: 2,
    fillColor: "#2962ff", opacity: 0.15, text: "Wave A",
    points: [
      { time: 100, price: 120 }, { time: 200, price: 80 },
      { time: 140, price: 60 }, { time: 230, price: 105 },
    ],
  };
}

function context() {
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      return () => undefined;
    },
    set(object, property, value) { object[property as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

const projector = { toX: (n: number) => n, toY: (n: number) => n, width: 800, height: 600 };

test("Phase 8 Wave A has complete render, bounds, move, anchor, and persistence-safe fixtures", () => {
  for (const tool of WAVE_A) {
    const adapter = getTool(tool);
    assert.ok(adapter, `${tool} adapter`);
    const drawing = fixture(tool);
    drawing.points = drawing.points.slice(0, adapter.minPoints);
    assert.doesNotThrow(() => adapter.render(context(), drawing, projector, true), tool);
    const bounds = adapter.boundingBox(drawing, projector.toX, projector.toY);
    assert.ok(bounds, `${tool} bounds`);
    assert.ok([bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite), `${tool} finite bounds`);
    assert.equal(adapter.getAnchors(drawing, projector.toX, projector.toY).length, drawing.points.length);
    const moved = adapter.move(drawing.points, { time: 150, price: 150 }, { time: 100, price: 100 });
    assert.equal(moved.length, drawing.points.length);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(drawing)));
  }
});

test("range, channel, annotation, and time families expose selectable visible geometry", () => {
  for (const [tool, hitPoint] of [
    ["datePriceRange", { x: 150, y: 100 }],
    ["flatTopBottom", { x: 150, y: 100 }],
    ["disjointChannel", { x: 150, y: 100 }],
    ["note", { x: 125, y: 95 }],
    ["callout", { x: 200, y: 80 }],
    ["cyclicLines", { x: 200, y: 300 }],
    ["fibTimeZone", { x: 300, y: 300 }],
  ] as const) {
    const adapter = getTool(tool)!;
    const drawing = fixture(tool);
    drawing.points = drawing.points.slice(0, adapter.minPoints);
    assert.ok(adapter.hitTest(drawing, hitPoint.x, hitPoint.y, projector.toX, projector.toY).length > 0, tool);
  }
});

test("callout leader line is selectable outside its text box", () => {
  const adapter = getTool("callout")!;
  const drawing = fixture("callout");
  drawing.points = drawing.points.slice(0, adapter.minPoints);
  assert.ok(
    adapter
      .hitTest(drawing, 150, 100, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    "the rendered callout connector must share the body hit contract",
  );
});

test("channel variant fill and additional anchors share resize geometry", () => {
  const flat: Drawing = {
    ...fixture("flatTopBottom"),
    fillColor: "#2962ff",
    points: [
      { time: 100, price: 120 },
      { time: 220, price: 100 },
      { time: 160, price: 60 },
    ],
  };
  assert.ok(
    getTool("flatTopBottom")!
      .hitTest(flat, 160, 90, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    "flat channel visible fill must be selectable",
  );
  const distantControl: Drawing = {
    ...flat,
    points: [flat.points[0], flat.points[1], { time: 300, price: 60 }],
  };
  const flatBounds = getTool("flatTopBottom")!.boundingBox(
    distantControl,
    projector.toX,
    projector.toY,
  )!;
  assert.ok(
    flatBounds.x + flatBounds.w >= 300,
    "the third control handle must participate in spatial culling bounds",
  );

  const disjoint: Drawing = {
    ...fixture("disjointChannel"),
    fillColor: "#2962ff",
    points: [
      { time: 100, price: 120 },
      { time: 220, price: 100 },
      { time: 100, price: 60 },
      { time: 220, price: 40 },
    ],
  };
  const adapter = getTool("disjointChannel")!;
  const thirdHit = adapter.hitTest(
    disjoint,
    100,
    60,
    projector.toX,
    projector.toY,
  ).find((hit) => hit.anchorIndex === 2);
  assert.ok(thirdHit && thirdHit.target !== "body");
  const resized = adapter.moveAnchor(disjoint.points, 2, { time: 90, price: 55 });
  assert.deepEqual(resized[0], disjoint.points[0]);
  assert.deepEqual(resized[1], disjoint.points[1]);
  assert.deepEqual(resized[2], { time: 90, price: 55 });
  assert.ok(
    adapter
      .hitTest(disjoint, 160, 80, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    "disjoint channel visible fill must be selectable",
  );
});

test("Price Range extension participates in hit testing and spatial bounds", () => {
  const adapter = getTool("priceRange")!;
  const drawing: Drawing = {
    ...fixture("priceRange"),
    extend: "right",
    fillColor: "transparent",
    points: [
      { time: 100, price: 120 },
      { time: 200, price: 40 },
    ],
  };
  assert.ok(
    adapter
      .hitTest(drawing, 600, 120, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    "rendered extended price line must be selectable",
  );
  const bounds = adapter.boundingBox(drawing, projector.toX, projector.toY)!;
  assert.ok(bounds.x + bounds.w > 600, "extended line must survive viewport culling");
  assert.equal(
    adapter
      .hitTest(drawing, 600, 80, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    false,
    "transparent range interior must not be selectable",
  );
});

test("Cyclic Lines hit testing covers every rendered bounded repetition", () => {
  const drawing: Drawing = {
    ...fixture("cyclicLines"),
    points: [
      { time: 100, price: 120 },
      { time: 101, price: 80 },
    ],
  };
  assert.ok(
    getTool("cyclicLines")!
      .hitTest(drawing, 300, 200, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    "a visible repetition after index 128 must remain selectable",
  );
});
