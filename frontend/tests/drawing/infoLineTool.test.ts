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
  const canvasCalls: Array<{ method: string; args: unknown[] }> = [];
  const propertyWrites: Array<{ property: string; value: unknown }> = [];
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
      canvasCalls.push({ method: "fillText", args: [text] });
    },
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      return (...args: unknown[]) => {
        methodCalls.push(String(property));
        canvasCalls.push({ method: String(property), args });
      };
    },
    set(object, property, value) {
      object[property as string] = value;
      propertyWrites.push({ property: String(property), value });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, methodCalls, renderedText, canvasCalls, propertyWrites };
}

function projector(barIntervalSeconds: number, width = 800, height = 600): Projector {
  return {
    toX,
    toY,
    width,
    height,
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

test("Info Line uses a compact endpoint-anchored panel with accessible contrast", () => {
  const adapter = getTool("infoLine");
  assert.ok(adapter);

  const recording = recordingContext();
  adapter.render(recording.context, fixture, projector(300), false);

  const firstPanelArc = recording.canvasCalls.find(
    ({ method }) => method === "arcTo",
  );
  assert.ok(firstPanelArc);
  const [, top, , bottom, radius] = firstPanelArc.args as number[];
  assert.equal(Math.round(bottom - top), 66);
  assert.equal(radius, 4);
  assert.ok(
    Math.abs(top - (toY(fixture.points[1].price)! - 33)) < 0.001,
    `expected the panel to center on the right endpoint, received top=${top}`,
  );
  assert.ok(
    recording.propertyWrites.some(
      ({ property, value }) =>
        property === "fillStyle" && value === "rgba(19, 23, 34, 0.96)",
    ),
  );
  assert.ok(
    recording.renderedText.some((text) => text.includes("3 bars (15m), 60 px")),
  );
  assert.ok(recording.renderedText.every((text) => !text.includes("distance:")));
});

test("Info Line panel stays inside compact chart panes and ellipsizes long rows", () => {
  const adapter = getTool("infoLine");
  assert.ok(adapter);

  const recording = recordingContext();
  adapter.render(recording.context, fixture, projector(60, 180, 80), false);

  const firstPanelArc = recording.canvasCalls.find(
    ({ method }) => method === "arcTo",
  );
  assert.ok(firstPanelArc);
  const [right, top, , bottom] = firstPanelArc.args as number[];
  assert.ok(right <= 90, `panel crossed the compact pane guard: right=${right}`);
  assert.ok(top >= 6, `panel crossed the pane top: top=${top}`);
  assert.ok(bottom <= 74, `panel crossed the pane bottom: bottom=${bottom}`);
  assert.ok(
    recording.renderedText.some((text) => text.endsWith("...")),
    `expected a compact ellipsis, received ${JSON.stringify(recording.renderedText)}`,
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
