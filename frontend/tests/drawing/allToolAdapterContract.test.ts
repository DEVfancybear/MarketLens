import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allTools,
  getTool,
} from "../../src/components/chart/drawing/tools/ToolRegistry";
import "../../src/components/chart/drawing/tools/adapters";
import { drawingFixture } from "../../src/components/chart/drawing/testing/toolFixtures";
import { DRAWING_TOOLS } from "../../src/types/drawing";

function recordingContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxAscent: 9,
      actualBoundingBoxDescent: 3,
    }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      return () => undefined;
    },
    set(object, property, value) {
      object[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const projector = {
  toX: (value: number) => value,
  toY: (value: number) => value,
  width: 800,
  height: 600,
  barIntervalSeconds: 60,
};

function finitePoints(points: ReadonlyArray<{ time: number; price: number }>) {
  return points.every(
    (point) => Number.isFinite(point.time) && Number.isFinite(point.price),
  );
}

test("all persistent adapters satisfy the executable geometry contract", () => {
  assert.deepEqual(
    allTools().map((adapter) => adapter.tool).sort(),
    [...DRAWING_TOOLS].sort(),
  );

  for (const tool of DRAWING_TOOLS) {
    const adapter = getTool(tool);
    assert.ok(adapter, `${tool}: registered adapter`);
    const fixture = drawingFixture(tool, adapter);

    assert.doesNotThrow(
      () => adapter.render(recordingContext(), fixture, projector, true),
      `${tool}: render`,
    );

    const bounds = adapter.boundingBox(
      fixture,
      projector.toX,
      projector.toY,
    );
    assert.ok(bounds, `${tool}: finite fixture must expose spatial bounds`);
    assert.ok(
      [bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite),
      `${tool}: finite bounds`,
    );
    assert.ok(bounds.w >= 0 && bounds.h >= 0, `${tool}: non-negative bounds`);

    const anchors = adapter.getAnchors(
      fixture,
      projector.toX,
      projector.toY,
    );
    assert.equal(
      new Set(anchors.map((anchor) => anchor.index)).size,
      anchors.length,
      `${tool}: unique anchor ids`,
    );
    for (const anchor of anchors) {
      assert.ok(Number.isInteger(anchor.index), `${tool}: integer anchor id`);
      assert.ok(
        (anchor.x == null && anchor.y == null) ||
          (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)),
        `${tool}: finite projected anchor`,
      );
    }

    const moved = adapter.move(
      fixture.points,
      { time: 170, price: 155 },
      { time: 120, price: 105 },
    );
    assert.equal(moved.length, fixture.points.length, `${tool}: move point count`);
    assert.ok(finitePoints(moved), `${tool}: finite move result`);

    const firstAnchor = anchors.find(
      (anchor) => anchor.x != null && anchor.y != null,
    );
    if (firstAnchor) {
      const resized = adapter.moveAnchor(
        fixture.points,
        firstAnchor.index,
        { time: fixture.points[0].time + 11, price: fixture.points[0].price + 7 },
      );
      assert.equal(resized.length, fixture.points.length, `${tool}: resize point count`);
      assert.ok(finitePoints(resized), `${tool}: finite resize result`);
    }

    const hitPoints = anchors.length > 0
      ? anchors.filter(
          (anchor): anchor is typeof anchor & { x: number; y: number } =>
            anchor.x != null && anchor.y != null,
        )
      : [{ index: -1, x: fixture.points[0].time, y: fixture.points[0].price, target: "body" as const }];
    for (const anchor of hitPoints) {
      const hits = adapter.hitTest(
        fixture,
        anchor.x,
        anchor.y,
        projector.toX,
        projector.toY,
      );
      assert.ok(hits.length > 0, `${tool}: visible anchor/body is selectable`);
      for (const hit of hits) {
        assert.ok(Number.isFinite(hit.distance), `${tool}: finite hit distance`);
        if (hit.target !== "body") {
          assert.ok(Number.isInteger(hit.anchorIndex), `${tool}: anchor identity`);
        }
      }
      if (anchor.index >= 0) {
        assert.ok(
          hits.some(
            (hit) => hit.target !== "body" && hit.anchorIndex === anchor.index,
          ),
          `${tool}: projected anchor ${anchor.index} must resolve to the same hit identity`,
        );
      }
    }
  }
});
