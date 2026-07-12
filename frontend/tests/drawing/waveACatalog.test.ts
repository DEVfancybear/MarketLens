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
