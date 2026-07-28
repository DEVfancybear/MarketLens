import { performance } from "node:perf_hooks";

import { SpatialIndex } from "../../src/components/chart/drawing/renderer/SpatialIndex";
import type { Drawing } from "../../src/types/drawing";

function drawing(index: number): Drawing {
  const column = index % 100;
  const row = Math.floor(index / 100);
  return {
    id: `baseline-${index}`,
    tool: "rectangle",
    color: "#2962ff",
    lineWidth: 2,
    points: [
      { time: column * 12, price: row * 8 },
      { time: column * 12 + 10, price: row * 8 + 6 },
    ],
  };
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

const rows = [];
for (const size of [100, 500, 1_000, 5_000]) {
  const drawings = Array.from({ length: size }, (_, index) => drawing(index));
  const rebuildSamples: number[] = [];
  const querySamples: number[] = [];
  let visible = 0;
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const index = new SpatialIndex();
    let started = performance.now();
    index.rebuild(drawings, (value) => value, (value) => value);
    rebuildSamples.push(performance.now() - started);
    started = performance.now();
    visible = index.queryViewport(200, 0, 600, 400).length;
    querySamples.push(performance.now() - started);
  }
  rows.push({
    drawings: size,
    visible,
    rebuildMedianMs: Number(percentile(rebuildSamples, 0.5).toFixed(3)),
    rebuildP95Ms: Number(percentile(rebuildSamples, 0.95).toFixed(3)),
    queryMedianMs: Number(percentile(querySamples, 0.5).toFixed(3)),
    queryP95Ms: Number(percentile(querySamples, 0.95).toFixed(3)),
  });
}

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
      iterations: 30,
      rows,
    },
    null,
    2,
  ),
);
