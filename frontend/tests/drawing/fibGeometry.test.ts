import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FIB_LEVELS,
  type Drawing,
} from "../../src/types/drawing";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import {
  fibLevelPrice,
  projectFibLevels,
  visibleFibLabels,
} from "../../src/components/chart/drawing/tools/plugins/fibGeometry";
import "../../src/components/chart/drawing/tools/plugins/FibTool";
import "../../src/components/chart/drawing/tools/plugins/FibRetracementTool";
import "../../src/components/chart/drawing/tools/plugins/FibExtensionTool";

function drawing(tool: "fib" | "fibRetracement" | "fibExtension"): Drawing {
  return {
    id: `fixture-${tool}`,
    tool,
    color: "#2962ff",
    lineWidth: 2,
    points: [
      { time: 10, price: 100 },
      { time: 20, price: 200 },
      { time: 30, price: 150 },
    ],
  };
}

test("legacy fib and retracement use the same level projection", () => {
  const legacy = projectFibLevels(drawing("fib"), (price) => price, "retracement");
  const modern = projectFibLevels(
    drawing("fibRetracement"),
    (price) => price,
    "retracement",
  );
  assert.deepEqual(
    legacy.map(({ level, price, y }) => [level.value, price, y]),
    modern.map(({ level, price, y }) => [level.value, price, y]),
  );
});

test("retracement log calculation and extension origin share explicit formulas", () => {
  const retracement = { ...drawing("fibRetracement"), fibLogScale: true };
  assert.ok(
    Math.abs(fibLevelPrice(retracement, 0.5, "retracement") - Math.sqrt(20000)) <
      1e-10,
  );
  assert.equal(fibLevelPrice(drawing("fibExtension"), 1, "extension"), 250);
});

test("fib label layout culls offscreen and colliding labels deterministically", () => {
  const levels = [{ y: -100 }, { y: 10 }, { y: 15 }, { y: 40 }, { y: 500 }];
  assert.deepEqual(visibleFibLabels(levels, 100, 12), [levels[1], levels[3]]);
});

function recordingContext() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const fonts: string[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      return (...args: unknown[]) => calls.push({ method: String(property), args });
    },
    set(object, property, value) {
      object[property as string] = value;
      if (property === "font") fonts.push(String(value));
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls, fonts };
}

const projector = {
  toX: (value: number) => value,
  toY: (value: number) => value,
  width: 800,
  height: 600,
};

test("fib adapters execute clipping, level rendering, hit, and spatial contracts", () => {
  assert.deepEqual(
    [1.272, 1.414, 1.618, 2.618, 4.236].filter((value) =>
      DEFAULT_FIB_LEVELS.some((level) => level.value === value),
    ),
    [1.272, 1.414, 1.618, 2.618, 4.236],
  );

  for (const tool of ["fib", "fibRetracement"] as const) {
    const adapter = getTool(tool);
    assert.ok(adapter);
    const fixture = drawing(tool);
    const recording = recordingContext();
    adapter.render(recording.context, fixture, projector, true);
    const methods = recording.calls.map((call) => call.method);
    assert.ok(methods.includes("clip"), `${tool}: price-scale guard clip`);
    assert.ok(methods.includes("fillRect"), `${tool}: background bands`);
    assert.ok(methods.includes("stroke"), `${tool}: guide and level strokes`);
    assert.ok(methods.includes("fillText"), `${tool}: measured labels`);
    assert.ok(
      recording.fonts.every((font) => !font.includes("var(--")),
      `${tool}: canvas fonts must be concrete CSS font strings`,
    );
    assert.ok(
      adapter
        .hitTest(fixture, 15, 161.8, projector.toX, projector.toY)
        .some((hit) => hit.target === "body"),
      `${tool}: visible 0.618 level is selectable`,
    );
    const bounds = adapter.boundingBox(fixture, projector.toX, projector.toY);
    assert.ok(bounds);
    assert.ok(bounds.y + bounds.h >= 523.6, `${tool}: external levels are bounded`);
  }
});

test("trend-based fib extension owns its third projection anchor", () => {
  const adapter = getTool("fibExtension");
  assert.ok(adapter);
  const fixture = drawing("fibExtension");
  assert.equal(adapter.maxPoints, 3);
  assert.deepEqual(
    adapter
      .getAnchors(fixture, projector.toX, projector.toY)
      .map(({ index, target }) => ({ index, target })),
    [
      { index: 0, target: "p1" },
      { index: 1, target: "p2" },
      { index: 2, target: "p3" },
    ],
  );
  const moved = adapter.moveAnchor(fixture.points, 2, { time: 40, price: 125 });
  assert.deepEqual(moved[2], { time: 40, price: 125 });
  assert.ok(
    adapter
      .hitTest(fixture, 100, 250, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    "extension levels projected from point C must be selectable",
  );
});
