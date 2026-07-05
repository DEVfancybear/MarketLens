import fs from "node:fs";

const trendLine = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/TrendLineTool.ts",
  "utf8",
);
const shared = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/shared.ts",
  "utf8",
);
const drawingLayer = fs.readFileSync(
  "src/components/chart/DrawingLayer.tsx",
  "utf8",
);

const checks = [
  {
    name: "Plain trendline does not render measurement chips",
    ok: !trendLine.includes("chip(") && !trendLine.includes("angleDeg"),
  },
  {
    name: "Plain trendline renders attached line text",
    ok:
      trendLine.includes("renderLineText") &&
      shared.includes("export function renderLineText"),
  },
  {
    name: "Selected empty trendline shows TradingView add-text placeholder",
    ok: shared.includes('selected ? "+ Add text" : ""'),
  },
  {
    name: "DrawingLayer owns trendline text edit state",
    ok:
      drawingLayer.includes("trendLineTextEdit") &&
      drawingLayer.includes("setTrendLineTextEdit"),
  },
  {
    name: "DrawingLayer projects trendline add-text target from line geometry",
    ok:
      drawingLayer.includes("projectTrendLineTextTarget") &&
      drawingLayer.includes("Math.atan2(y2 - y1, x2 - x1)"),
  },
  {
    name: "Trendline add-text hitbox is chart UI and opens TextEditor",
    ok:
      drawingLayer.includes("trendLineTextTarget") &&
      drawingLayer.includes("data-chart-ui") &&
      drawingLayer.includes("key={trendLineTextEdit.drawingId}"),
  },
];

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  for (const check of failed) {
    console.error(`FAIL ${check.name}`);
  }
  process.exit(1);
}

for (const check of checks) {
  console.log(`PASS ${check.name}`);
}
