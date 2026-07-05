import fs from "node:fs";

const verticalTool = fs.readFileSync(
  "src/components/chart/drawing/tools/plugins/VerticalTool.ts",
  "utf8",
);

const checks = [
  {
    name: "Vertical line no longer renders the old center handle",
    ok: !verticalTool.includes("handle(") && !verticalTool.includes("proj.height / 2"),
  },
  {
    name: "Vertical line renders a TradingView-style date label chip",
    ok:
      verticalTool.includes("drawDateLabel") &&
      verticalTool.includes("DATE_LABEL_H") &&
      verticalTool.includes("DATE_LABEL_BOTTOM_GAP") &&
      verticalTool.includes("roundedRect"),
  },
  {
    name: "Vertical date label uses weekday day month year and time",
    ok:
      verticalTool.includes("formatVerticalDateLabel") &&
      verticalTool.includes("WEEKDAYS") &&
      verticalTool.includes("MONTHS") &&
      verticalTool.includes("getUTCHours") &&
      verticalTool.includes("getUTCMinutes"),
  },
  {
    name: "Vertical date label is clamped inside the chart viewport",
    ok:
      verticalTool.includes("Math.min(x - w / 2") &&
      verticalTool.includes("proj.width - w - 4") &&
      verticalTool.includes("g.fillText(text") &&
      verticalTool.includes("w - 8"),
  },
  {
    name: "Vertical line keeps body hit-test and move behavior",
    ok:
      verticalTool.includes("target: \"body\"") &&
      verticalTool.includes("movePoints: defaultMovePoints") &&
      verticalTool.includes("Math.abs(x - px) < TOL"),
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
