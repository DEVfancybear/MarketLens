import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  decodeDrawingToolPreferences,
  pickDrawingToolDefaults,
  resolveDrawingCreationDefaults,
} from "../../src/components/chart/drawing/settings/drawingToolPreferences";
import { DEFAULT_EMOJI_SELECTION } from "../../src/types/emojiCatalog";

test("tool defaults retain configurable fields but never object state or geometry", () => {
  const drawing: Drawing = {
    id: "rect-1",
    tool: "rectangle",
    color: "#abcdef",
    lineWidth: 3,
    fillColor: "#123456",
    opacity: 0.4,
    text: "object-specific content",
    visible: false,
    locked: true,
    zIndex: 42,
    points: [{ time: 10, price: 20 }, { time: 30, price: 40 }],
  };

  assert.deepEqual(pickDrawingToolDefaults(drawing), {
    color: "#abcdef",
    lineWidth: 3,
    fillColor: "#123456",
    opacity: 0.4,
  });
});

test("creation defaults layer manifest, current color, and per-tool user settings", () => {
  const defaults = resolveDrawingCreationDefaults(
    "trendline",
    {
      color: "#ff0000",
      lineWidth: 4,
      lineStyle: "dashed",
      points: [{ time: 999, price: 999 }],
      id: "must-not-leak",
    },
    "#2962ff",
  );

  assert.equal(defaults.color, "#ff0000");
  assert.equal(defaults.lineWidth, 4);
  assert.equal(defaults.lineStyle, "dashed");
  assert.equal(defaults.points, undefined);
  assert.equal(defaults.id, undefined);

  const highlighter = resolveDrawingCreationDefaults(
    "highlighter",
    undefined,
    "#ffd54f",
  );
  assert.equal(highlighter.lineWidth, 8);
  assert.equal(highlighter.opacity, 0.35);

  const regression = resolveDrawingCreationDefaults(
    "regressionTrend",
    undefined,
    "#2962ff",
  );
  assert.deepEqual(
    {
      regressionUpperDeviation: regression.regressionUpperDeviation,
      regressionLowerDeviation: regression.regressionLowerDeviation,
      regressionUseUpperDeviation: regression.regressionUseUpperDeviation,
      regressionUseLowerDeviation: regression.regressionUseLowerDeviation,
      regressionSource: regression.regressionSource,
      regressionShowBaseLine: regression.regressionShowBaseLine,
      regressionShowUpperLine: regression.regressionShowUpperLine,
      regressionShowLowerLine: regression.regressionShowLowerLine,
      regressionExtendLines: regression.regressionExtendLines,
      regressionShowPearsonR: regression.regressionShowPearsonR,
    },
    {
      regressionUpperDeviation: 2,
      regressionLowerDeviation: -2,
      regressionUseUpperDeviation: true,
      regressionUseLowerDeviation: true,
      regressionSource: "close",
      regressionShowBaseLine: true,
      regressionShowUpperLine: true,
      regressionShowLowerLine: true,
      regressionExtendLines: false,
      regressionShowPearsonR: true,
    },
  );

  const profile = resolveDrawingCreationDefaults(
    "fixedVolumeProfile",
    { volumeProfileRows: 48, volumeProfilePlacement: "left" },
    "#2962ff",
  );
  assert.equal(profile.volumeProfileRows, 48);
  assert.equal(profile.volumeProfilePlacement, "left");
  assert.equal(profile.volumeProfileValueAreaPercent, 70);
  assert.equal(profile.volumeProfileShowPointOfControl, true);
});

test("volume-profile tool defaults preserve every typed control", () => {
  const drawing: Drawing = {
    id: "profile",
    tool: "anchoredVolumeProfile",
    color: "#2962ff",
    lineWidth: 1.5,
    points: [{ time: 1, price: 2 }],
    volumeProfileRows: 50,
    volumeProfileValueAreaPercent: 65,
    volumeProfileWidthPercent: 40,
    volumeProfilePlacement: "left",
    volumeProfileVolumeMode: "total",
    volumeProfileShowHistogram: false,
    volumeProfileShowPointOfControl: false,
    volumeProfileShowValueAreaHigh: false,
    volumeProfileShowValueAreaLow: true,
  };
  const defaults = pickDrawingToolDefaults(drawing);
  assert.equal(defaults.volumeProfileRows, 50);
  assert.equal(defaults.volumeProfileValueAreaPercent, 65);
  assert.equal(defaults.volumeProfileWidthPercent, 40);
  assert.equal(defaults.volumeProfilePlacement, "left");
  assert.equal(defaults.volumeProfileVolumeMode, "total");
  assert.equal(defaults.volumeProfileShowHistogram, false);
  assert.equal(defaults.volumeProfileShowPointOfControl, false);
  assert.equal(defaults.volumeProfileShowValueAreaHigh, false);
  assert.equal(defaults.volumeProfileShowValueAreaLow, true);
});

test("preference decoder rejects unknown versions, tools, and unsafe fields", () => {
  assert.deepEqual(decodeDrawingToolPreferences({ version: 99, keepDrawing: true }), {
    version: 1,
    keepDrawing: false,
    magnetEnabled: false,
    magnetMode: "weak",
    snapToIndicators: false,
    toolDefaults: {},
    emojiSelection: DEFAULT_EMOJI_SELECTION,
    emojiRecents: [],
  });

  const decoded = decodeDrawingToolPreferences({
    version: 1,
    keepDrawing: true,
    magnetEnabled: true,
    magnetMode: "strong",
    toolDefaults: {
      trendline: {
        color: "#00ff00",
        lineWidth: 2,
        points: [{ time: 1, price: 2 }],
        visible: false,
      },
      unknownTool: { color: "red" },
    },
  });

  assert.equal(decoded.keepDrawing, true);
  assert.equal(decoded.magnetEnabled, true);
  assert.equal(decoded.magnetMode, "strong");
  assert.equal(decoded.snapToIndicators, false);
  assert.deepEqual(decoded.toolDefaults.trendline, {
    color: "#00ff00",
    lineWidth: 2,
  });
  assert.equal((decoded.toolDefaults as Record<string, unknown>).unknownTool, undefined);
});

test("emoji selection is a safe synced default while ordinary drawing text stays object-specific", () => {
  const emoji: Drawing = {
    id: "emoji-1",
    tool: "emoji",
    color: "#2962ff",
    lineWidth: 1.5,
    text: "🐂📈",
    fontSize: 34,
    points: [{ time: 10, price: 20 }],
  };
  const emojiDefaults = pickDrawingToolDefaults(emoji);
  assert.equal(emojiDefaults.text, "🐂📈");
  assert.equal(emojiDefaults.fontSize, 34);
  assert.equal(emojiDefaults.points, undefined);

  const resolved = resolveDrawingCreationDefaults(
    "emoji",
    { text: "◆︎", fontSize: 28 },
    "#089981",
  );
  assert.equal(resolved.text, "◆︎");
  assert.equal(resolved.fontSize, 28);
  assert.equal(resolved.color, "#089981");

  const rectangle = resolveDrawingCreationDefaults(
    "rectangle",
    { text: "must not become a default" },
    "#2962ff",
  );
  assert.equal(rectangle.text, undefined);
});

test("preference decoder validates backend-synced emoji selection and recent history", () => {
  const decoded = decodeDrawingToolPreferences({
    version: 1,
    keepDrawing: false,
    magnetEnabled: false,
    magnetMode: "weak",
    snapToIndicators: false,
    toolDefaults: {
      emoji: { text: "🐂📈", fontSize: 36 },
    },
    emojiSelection: { kind: "sticker", value: "🐂📈" },
    emojiRecents: [
      { kind: "sticker", value: "🐂📈" },
      { kind: "sticker", value: "🐂📈" },
      { kind: "icon", value: "not-in-catalog" },
      { kind: "emoji", value: "😊" },
    ],
  });

  assert.deepEqual(decoded.emojiSelection, {
    kind: "sticker",
    value: "🐂📈",
  });
  assert.deepEqual(decoded.emojiRecents, [
    { kind: "sticker", value: "🐂📈" },
    { kind: "emoji", value: "😊" },
  ]);
  assert.equal(decoded.toolDefaults.emoji?.text, "🐂📈");
  assert.equal(decoded.toolDefaults.emoji?.fontSize, 36);
});

test("legacy indicator magnet preference migrates to an independent source toggle", () => {
  const decoded = decodeDrawingToolPreferences({
    version: 1,
    keepDrawing: false,
    magnetEnabled: true,
    magnetMode: "indicator",
    toolDefaults: {},
  });
  assert.equal(decoded.magnetMode, "weak");
  assert.equal(decoded.snapToIndicators, true);
});

test("position input preferences persist without carrying projected price geometry", () => {
  const position: Drawing = {
    id: "long-1",
    tool: "long",
    color: "#089981",
    lineWidth: 1,
    points: [{ time: 1, price: 100 }],
    accountSize: 10_000,
    riskValue: 1,
    riskUnit: "%",
    stop: 99,
    target: 102,
  };

  const defaults = pickDrawingToolDefaults(position);
  assert.equal(defaults.accountSize, 10_000);
  assert.equal(defaults.riskValue, 1);
  assert.equal(defaults.riskUnit, "%");
  assert.equal(defaults.stop, undefined);
  assert.equal(defaults.target, undefined);
  assert.equal(defaults.points, undefined);
});
