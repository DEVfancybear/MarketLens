import fs from "node:fs";

const infoLine = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/InfoLineTool.ts",
  "utf8",
);

const checks = [
  {
    name: "InfoLine no longer uses the generic blue chip helper",
    ok: !infoLine.includes("chip(") && !infoLine.includes("import { line, handle, chip"),
  },
  {
    name: "InfoLine renders a TradingView-style stats panel",
    ok:
      infoLine.includes("renderInfoPanel") &&
      infoLine.includes("PANEL_MIN_W") &&
      infoLine.includes("PANEL_H") &&
      infoLine.includes("rgba(70, 70, 70, 0.92)"),
  },
  {
    name: "InfoLine panel includes price, bars/time/pixels, and angle rows",
    ok:
      infoLine.includes("tickSpan") &&
      infoLine.includes("bars") &&
      infoLine.includes("distance") &&
      infoLine.includes("angle.toFixed"),
  },
  {
    name: "InfoLine panel derives bar count from active timeframe",
    ok:
      infoLine.includes("timeframeAtom") &&
      infoLine.includes("TF_SECONDS") &&
      infoLine.includes("Math.round(elapsed / tfSeconds)"),
  },
  {
    name: "InfoLine measures and clamps panel text so rows do not overflow",
    ok:
      infoLine.includes("measureText") &&
      infoLine.includes("fitText") &&
      infoLine.includes("availableTextWidth") &&
      infoLine.includes("panelWidth"),
  },
  {
    name: "InfoLine panel reserves and clips away from the right price scale",
    ok:
      infoLine.includes("RIGHT_PRICE_SCALE_GUARD") &&
      infoLine.includes("usablePanelRight") &&
      infoLine.includes("g.rect(0, 0, usableRight, proj.height)") &&
      infoLine.includes("g.clip()") &&
      infoLine.includes("rightOfLine + panelWidth <= usableRight"),
  },
  {
    name: "InfoLine keeps the panel in its spatial bounding box",
    ok:
      infoLine.includes("PANEL_CULL_W + 24") &&
      infoLine.includes("PANEL_H + 56"),
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
