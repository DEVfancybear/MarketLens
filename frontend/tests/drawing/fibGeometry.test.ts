import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  fibLevelPrice,
  projectFibLevels,
  visibleFibLabels,
} from "../../src/components/chart/drawing/tools/plugins/fibGeometry";

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
