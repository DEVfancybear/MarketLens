import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import type { Projector } from "../../src/components/chart/drawing/drawingRenderer";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/plugins/InfoLineTool";

const fixture: Drawing = {
  id: "info-line-fixture",
  tool: "infoLine",
  color: "#2962ff",
  lineWidth: 2,
  points: [
    { time: 0, price: 1.1 },
    { time: 900, price: 1.101 },
  ],
};

const toX = (time: number) => time / 15;
const toY = (price: number) => (price - 1) * 1_000;

function recordingContext() {
  const methodCalls: string[] = [];
  const renderedText: string[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxAscent: 9,
      actualBoundingBoxDescent: 3,
    }),
    fillText: (text: string) => {
      methodCalls.push("fillText");
      renderedText.push(text);
    },
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      return (..._args: unknown[]) => methodCalls.push(String(property));
    },
    set(object, property, value) {
      object[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, methodCalls, renderedText };
}

function projector(barIntervalSeconds: number): Projector {
  return {
    toX,
    toY,
    width: 800,
    height: 600,
    barIntervalSeconds,
  };
}

test("Info Line renders in isolation and derives bar count from its projector", () => {
  const adapter = getTool("infoLine");
  assert.ok(adapter);

  const fiveMinute = recordingContext();
  adapter.render(fiveMinute.context, fixture, projector(300), false);
  assert.ok(fiveMinute.methodCalls.includes("stroke"));
  assert.ok(fiveMinute.methodCalls.includes("clip"));
  assert.ok(
    fiveMinute.renderedText.some((text) => text.startsWith("3 bars (15m)")),
    `expected a 3-bar row, received ${JSON.stringify(fiveMinute.renderedText)}`,
  );

  const oneMinute = recordingContext();
  adapter.render(oneMinute.context, fixture, projector(60), false);
  assert.ok(
    oneMinute.renderedText.some((text) => text.startsWith("15 bars (15m)")),
    `expected a 15-bar row, received ${JSON.stringify(oneMinute.renderedText)}`,
  );
});

test("Info Line exposes matching segment hits, anchors, and finite culling bounds", () => {
  const adapter = getTool("infoLine");
  assert.ok(adapter);

  const x1 = toX(fixture.points[0].time);
  const y1 = toY(fixture.points[0].price);
  const x2 = toX(fixture.points[1].time);
  const y2 = toY(fixture.points[1].price);
  const bodyHits = adapter.hitTest(
    fixture,
    (x1 + x2) / 2,
    (y1 + y2) / 2,
    toX,
    toY,
  );
  assert.ok(bodyHits.some((hit) => hit.target === "body"));

  const anchorHits = adapter.hitTest(fixture, x1, y1, toX, toY);
  assert.ok(
    anchorHits.some((hit) => hit.target === "p1" && hit.anchorIndex === 0),
  );
  assert.deepEqual(
    adapter.getAnchors(fixture, toX, toY).map(({ index, target }) => ({
      index,
      target,
    })),
    [
      { index: 0, target: "p1" },
      { index: 1, target: "p2" },
    ],
  );

  const bounds = adapter.boundingBox(fixture, toX, toY);
  assert.ok(bounds);
  assert.ok(
    [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite),
  );
  assert.ok(bounds.x <= x1 && bounds.y <= Math.min(y1, y2));
  assert.ok(bounds.x + bounds.w >= x2);
  assert.ok(bounds.y + bounds.h >= Math.max(y1, y2));
});
