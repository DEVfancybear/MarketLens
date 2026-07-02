import fs from "node:fs";

const types = fs.readFileSync("src/types/drawing.ts", "utf8");
const retracement = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/FibRetracementTool.ts",
  "utf8",
);
const extension = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/FibExtensionTool.ts",
  "utf8",
);
const legacy = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/FibTool.ts",
  "utf8",
);
const toolbar = fs.readFileSync("src/components/toolbar/DrawingToolbar.tsx", "utf8");

const checks = [
  {
    name: "Fib retracement preset includes TradingView-style external levels",
    ok:
      types.includes("1.272") &&
      types.includes("1.414") &&
      types.includes("1.618") &&
      types.includes("2.618") &&
      types.includes("4.236"),
  },
  {
    name: "Fib retracement renders trend line, background bands, levels, and price labels",
    ok:
      retracement.includes("FILL_OPACITY") &&
      retracement.includes("fillRect") &&
      retracement.includes("levelPrice") &&
      retracement.includes("formatPrice") &&
      retracement.includes("canvasFont(11") &&
      retracement.includes("distToSegment"),
  },
  {
    name: "Fib retracement hit-test covers each horizontal level and the trend line",
    ok:
      retracement.includes("for (const { y } of projectedLevels") &&
      retracement.includes("distToSegment(px, py, left, y, right, y)") &&
      retracement.includes("trendDist"),
  },
  {
    name: "Fib extension is a three-click trend-based tool",
    ok:
      extension.includes('tool: "fibExtension"') &&
      extension.includes("minPoints: 2") &&
      extension.includes("maxPoints: 3") &&
      extension.includes("projectionOrigin"),
  },
  {
    name: "Fib extension projects from point C using the A-B impulse",
    ok:
      extension.includes("return c.price + (b.price - a.price) * level") &&
      extension.includes("line(g, x2, y2, x3, y3)") &&
      extension.includes("target: i === 0 ? \"p1\" : i === 1 ? \"p2\" : \"p3\""),
  },
  {
    name: "Fib extension exposes p3 as a real draggable anchor",
    ok:
      extension.includes("getAnchors") &&
      extension.includes('target: i === 0 ? "p1" : i === 1 ? "p2" : "p3"'),
  },
  {
    name: "Legacy fib mirrors modern retracement rendering enough for saved drawings",
    ok:
      legacy.includes("FIB_LEVELS") &&
      legacy.includes("FILL_OPACITY") &&
      legacy.includes("formatPrice") &&
      legacy.includes("distToSegment"),
  },
  {
    name: "Toolbar labels fib extension as trend-based",
    ok: toolbar.includes("Trend-Based Fib Extension"),
  },
  {
    name: "Fib plugins avoid invalid canvas font strings with CSS variables",
    ok:
      !retracement.includes("var(--font") &&
      !extension.includes("var(--font") &&
      !legacy.includes("var(--font"),
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
