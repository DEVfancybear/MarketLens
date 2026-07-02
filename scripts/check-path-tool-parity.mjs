import fs from "node:fs";

const pathTool = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/PathTool.ts",
  "utf8",
);
const polylineTool = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/PolylineTool.ts",
  "utf8",
);
const curveTool = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/CurveTool.ts",
  "utf8",
);
const hitTestEngine = fs.readFileSync(
  "src/components/chart/drawing/hittest/HitTestEngine.ts",
  "utf8",
);
const interaction = fs.readFileSync(
  "src/components/chart/drawing/interaction/DrawingInteractionManager.ts",
  "utf8",
);

const checks = [
  {
    name: "Path remains a TradingView-style open click-to-add tool",
    ok:
      pathTool.includes('tool: "path"') &&
      pathTool.includes("freeform: true") &&
      pathTool.includes("arrowHead(") &&
      !pathTool.includes("g.closePath()") &&
      !pathTool.includes("g.fill()"),
  },
  {
    name: "Path vertices resolve by explicit anchor index",
    ok:
      pathTool.includes("function vertexTarget") &&
      pathTool.includes("anchorIndex: i") &&
      pathTool.includes("getAnchors") &&
      hitTestEngine.includes("let anchorIdx = c.anchorIndex ?? -1"),
  },
  {
    name: "Sibling freeform tools use the same vertex-index contract",
    ok:
      polylineTool.includes("anchorIndex: i") &&
      polylineTool.includes("getAnchors") &&
      curveTool.includes("anchorIndex: i") &&
      curveTool.includes("getAnchors"),
  },
  {
    name: "Escape finishes a freeform drawing instead of always cancelling it",
    ok:
      interaction.includes('if (e.key === "Escape")') &&
      interaction.includes("adapter?.freeform && pts.length >= adapter.minPoints") &&
      interaction.includes("points: pts.map((q) => ({ ...q }))"),
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
