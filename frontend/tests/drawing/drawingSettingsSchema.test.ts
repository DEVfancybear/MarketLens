import assert from "node:assert/strict";
import { test } from "node:test";
import type { Drawing } from "../../src/types/drawing";
import { applyDrawingTemplateStyle, getDrawingSettingsSchema, pickDrawingTemplateStyle } from "../../src/components/chart/drawing/settings/drawingSettingsSchema";
import { buildDrawingSettingsCommit, buildDrawingSettingsRevert } from "../../src/components/chart/drawing/settings/drawingSettingsTransaction";

test("settings schema derives family tabs and fields from manifest capabilities", () => {
  assert.deepEqual(getDrawingSettingsSchema("trendline").tabs, ["style", "text", "coordinates", "visibility"]);
  assert.equal(getDrawingSettingsSchema("rectangle").hasField("fillColor"), true);
  assert.equal(getDrawingSettingsSchema("rectangle").hasField("showMiddleLine"), true);
  assert.equal(getDrawingSettingsSchema("circle").hasField("showMiddleLine"), false);
  assert.equal(getDrawingSettingsSchema("fibRetracement").hasFeature("fib-levels"), true);
  assert.deepEqual(getDrawingSettingsSchema("text").tabs, ["text", "coordinates", "visibility"]);
  assert.deepEqual(getDrawingSettingsSchema("long").tabs, ["inputs", "style", "coordinates", "visibility"]);
  assert.equal(getDrawingSettingsSchema("short").hasField("riskValue"), true);
  assert.equal(getDrawingSettingsSchema("trendline").hasField("intervalVisibility"), true);
  assert.equal(getDrawingSettingsSchema("trendline").hasField("lineEnd"), true);
  assert.equal(getDrawingSettingsSchema("trendline").hasField("lineStats"), true);
  assert.equal(getDrawingSettingsSchema("trendline").hasField("lineStatsPosition"), true);
  assert.equal(getDrawingSettingsSchema("trendline").hasField("alwaysShowLineStats"), true);
  assert.equal(getDrawingSettingsSchema("channel").hasField("channelLevels"), true);
  assert.equal(getDrawingSettingsSchema("channel").hasField("channelBackground"), true);
  assert.deepEqual(getDrawingSettingsSchema("regressionTrend").tabs, [
    "inputs",
    "style",
    "coordinates",
    "visibility",
  ]);
  assert.equal(getDrawingSettingsSchema("regressionTrend").coordinatePriceEditable, false);
  assert.equal(getDrawingSettingsSchema("trendline").coordinatePriceEditable, true);
  for (const tool of ["fixedVolumeProfile", "anchoredVolumeProfile"] as const) {
    const schema = getDrawingSettingsSchema(tool);
    assert.deepEqual(schema.tabs, ["inputs", "style", "coordinates", "visibility"]);
    for (const field of [
      "volumeProfileRows",
      "volumeProfileValueAreaPercent",
      "volumeProfileWidthPercent",
      "volumeProfilePlacement",
      "volumeProfileVolumeMode",
      "volumeProfileShowHistogram",
      "volumeProfileShowPointOfControl",
      "volumeProfileShowValueAreaHigh",
      "volumeProfileShowValueAreaLow",
    ] as const) assert.equal(schema.hasField(field), true, `${tool}:${field}`);
  }
  for (const field of [
    "regressionUpperDeviation",
    "regressionLowerDeviation",
    "regressionUseUpperDeviation",
    "regressionUseLowerDeviation",
    "regressionSource",
    "regressionShowBaseLine",
    "regressionShowUpperLine",
    "regressionShowLowerLine",
    "regressionExtendLines",
    "regressionShowPearsonR",
  ] as const) {
    assert.equal(getDrawingSettingsSchema("regressionTrend").hasField(field), true, field);
  }
  assert.equal(getDrawingSettingsSchema("text").hasField("points"), true);
  assert.deepEqual(getDrawingSettingsSchema("long").coordinateLabels, ["Entry", "Target", "Stop"]);
});

test("settings schemas cover every current family and transactions preserve snapshots", () => {
  const families = ["trendline", "rectangle", "text", "fibRetracement", "long"] as const;
  assert.deepEqual(families.map((tool) => getDrawingSettingsSchema(tool).profile), [
    "line", "shape", "text", "fib", "position",
  ]);

  const snapshot: Drawing = { id: "t", tool: "text", color: "white", lineWidth: 1, text: "before", points: [{ time: 1, price: 2 }] };
  const preview: Drawing = { ...snapshot, text: "after", bold: true };
  const change = buildDrawingSettingsCommit(preview, snapshot);
  assert.deepEqual(change?.before, { text: "before", bold: undefined });
  assert.deepEqual(change?.after, { text: "after", bold: true });
  assert.deepEqual({ ...preview, ...buildDrawingSettingsRevert(preview, snapshot) }, { ...snapshot, bold: undefined });
});

test("template pick/apply is capability scoped and never carries geometry", () => {
  const rectangle: Drawing = { id: "r", tool: "rectangle", color: "#fff", lineWidth: 2, fillColor: "#000", points: [{ time: 1, price: 2 }, { time: 3, price: 4 }], fibLevels: [{ value: 1, enabled: true, color: "red" }] };
  const picked = pickDrawingTemplateStyle(rectangle);
  assert.equal(picked.fillColor, "#000");
  assert.equal(picked.points, undefined);
  assert.equal(picked.intervalVisibility, undefined);
  assert.equal(picked.fibLevels, undefined);
  const linePatch = applyDrawingTemplateStyle("trendline", picked);
  assert.equal(linePatch.fillColor, undefined);
  assert.equal(linePatch.color, "#fff");

  const regression: Drawing = {
    id: "regression",
    tool: "regressionTrend",
    color: "#fff",
    lineWidth: 2,
    points: [{ time: 1, price: 2 }, { time: 3, price: 4 }],
    regressionSource: "hlc3",
    regressionUpperDeviation: 1.5,
    regressionShowPearsonR: false,
  };
  const regressionTemplate = pickDrawingTemplateStyle(regression);
  assert.equal(regressionTemplate.regressionSource, "hlc3");
  assert.equal(regressionTemplate.regressionUpperDeviation, 1.5);
  assert.equal(regressionTemplate.regressionShowPearsonR, false);
  assert.equal(
    applyDrawingTemplateStyle("regressionTrend", regressionTemplate).regressionSource,
    "hlc3",
  );

  const profile: Drawing = {
    id: "profile",
    tool: "fixedVolumeProfile",
    color: "#2962ff",
    lineWidth: 1,
    points: [{ time: 1, price: 2 }, { time: 3, price: 4 }],
    volumeProfileRows: 64,
    volumeProfileValueAreaPercent: 68,
    volumeProfileWidthPercent: 45,
    volumeProfilePlacement: "left",
    volumeProfileVolumeMode: "delta",
    volumeProfileShowPointOfControl: false,
  };
  const profileTemplate = pickDrawingTemplateStyle(profile);
  assert.equal(profileTemplate.volumeProfileRows, 64);
  assert.equal(profileTemplate.volumeProfilePlacement, "left");
  assert.equal(
    applyDrawingTemplateStyle("anchoredVolumeProfile", profileTemplate).volumeProfileVolumeMode,
    "delta",
  );
});
