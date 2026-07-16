import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  DEFAULT_GANN_BOX_CONFIG,
  DEFAULT_GANN_FAN_CONFIG,
  DEFAULT_GANN_GRID_LEVELS,
  DEFAULT_GANN_SQUARE_CONFIG,
  resolveGannConfig,
} from "../../src/types/gann";
import { decodeDrawing } from "../../src/components/chart/drawing/persistence/drawingCodec";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import { applyDrawingTemplateStyle } from "../../src/components/chart/drawing/settings/drawingSettingsSchema";
import { resolveDrawingCreationDefaults } from "../../src/components/chart/drawing/settings/drawingToolPreferences";
import {
  constrainGannAnchor,
  constrainGannResize,
  gannLogicalBars,
  gannPriceBarRatio,
  projectGannFan,
  projectGannGrid,
  setGannScaleLock,
} from "../../src/components/chart/drawing/tools/plugins/gannGeometry";
import "../../src/components/chart/drawing/tools/plugins/LevelFanTools";
import "../../src/components/chart/drawing/tools/plugins/GannGridTools";

const toX = (value: number) => value;
const toY = (value: number) => value;

function fixture(tool: Drawing["tool"]): Drawing {
  return {
    id: `gann-${tool}`,
    tool,
    color: "#2962ff",
    lineWidth: 2,
    fillColor: "#2962ff",
    opacity: 0.1,
    points: [
      { time: 100, price: 100 },
      { time: 200, price: 200 },
    ],
  };
}

function strokeRecordingContext() {
  const strokes: Array<{
    color: string;
    opacity: number;
    width: number;
    dash: number[];
  }> = [];
  const state: Record<PropertyKey, unknown> = {
    canvas: { width: 800, height: 600 },
    strokeStyle: "#000000",
    fillStyle: "#000000",
    globalAlpha: 1,
    lineWidth: 1,
    dash: [] as number[],
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
  state.setLineDash = (dash: number[]) => {
    state.dash = [...dash];
  };
  state.stroke = () => strokes.push({
    color: String(state.strokeStyle),
    opacity: Number(state.globalAlpha),
    width: Number(state.lineWidth),
    dash: [...(state.dash as number[])],
  });
  const context = new Proxy(state, {
    get(target, property) {
      if (property in target) return target[property];
      return () => undefined;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, strokes };
}

test("Gann preset catalogs contain nine canonical fan angles and equal eighths", () => {
  assert.deepEqual(
    DEFAULT_GANN_FAN_CONFIG.ratios.map((item) => item.label),
    ["1/8", "1/4", "1/3", "1/2", "1/1", "2/1", "3/1", "4/1", "8/1"],
  );
  assert.deepEqual(
    DEFAULT_GANN_GRID_LEVELS.map((item) => item.value),
    [0, 1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 1],
  );
  assert.equal(
    new Set(DEFAULT_GANN_GRID_LEVELS.map((item) => item.color)).size,
    DEFAULT_GANN_GRID_LEVELS.length,
    "turning off Use one color must expose the configured level palette",
  );
});

test("Gann resolver bounds malformed persisted payloads without crossing families", () => {
  const fan = resolveGannConfig({
    family: "fan",
    priceBarRatio: -2,
    scaleLock: true,
    ratios: [
      { ratio: -1, enabled: true },
      { ratio: 2, label: "2/1", enabled: false, lineWidth: 99, opacity: 2 },
    ],
  }, "fan");
  assert.equal(fan.family, "fan");
  assert.equal(fan.priceBarRatio, 1);
  assert.equal(fan.scaleLock, true);
  assert.deepEqual(fan.ratios, [{
    ratio: 2,
    label: "2/1",
    enabled: false,
    lineWidth: 12,
    opacity: 1,
  }]);

  const square = resolveGannConfig({ family: "box" }, "square");
  assert.deepEqual(square, structuredClone(DEFAULT_GANN_SQUARE_CONFIG));

  const styledBox = resolveGannConfig({
    family: "box",
    priceLevels: [{
      value: 0.5,
      enabled: true,
      color: "  #f23645  ",
      opacity: -1,
      lineWidth: 99,
      lineStyle: "dotted",
    }],
    timeLevels: [{
      value: 0.25,
      enabled: true,
      color: "#26a69a",
      opacity: 0.4,
      lineWidth: 3,
      lineStyle: "dashed",
    }],
  }, "box");
  assert.equal(styledBox.family, "box");
  assert.deepEqual(styledBox.priceLevels, [{
    value: 0.5,
    enabled: true,
    color: "#f23645",
    opacity: 0,
    lineWidth: 12,
    lineStyle: "dotted",
  }]);
  assert.deepEqual(styledBox.timeLevels, [{
    value: 0.25,
    enabled: true,
    color: "#26a69a",
    opacity: 0.4,
    lineWidth: 3,
    lineStyle: "dashed",
  }]);
});

test("Gann Fan geometry honors enabled custom ratios, labels, and reverse", () => {
  const drawing = fixture("gannFan");
  drawing.gann = {
    ...structuredClone(DEFAULT_GANN_FAN_CONFIG),
    reverse: true,
    ratios: [
      { ratio: 0.5, label: "1/2", enabled: false },
      { ratio: 2, label: "2/1", enabled: true, color: "#f00" },
    ],
  };
  const geometry = projectGannFan(drawing, toX, toY)!;
  assert.deepEqual(geometry.origin, { x: 200, y: 200 });
  assert.deepEqual(geometry.control, { x: 100, y: 100 });
  assert.equal(geometry.strokes.length, 1);
  assert.deepEqual(geometry.strokes[0], {
    segment: {
      a: { x: 200, y: 200 },
      b: { x: 100, y: 0 },
    },
    color: "#f00",
    opacity: undefined,
    lineWidth: undefined,
    lineStyle: undefined,
    label: "2/1",
  });
});

test("Gann Square and Box use the same configurable price/time partitions", () => {
  const square = fixture("gannSquare");
  square.gann = {
    ...structuredClone(DEFAULT_GANN_SQUARE_CONFIG),
    reverse: true,
    priceLevels: [{ value: 0.25, enabled: true }],
    timeLevels: [{ value: 0.75, enabled: true }],
  };
  const squareGeometry = projectGannGrid(square, "square", toX, toY)!;
  assert.equal(squareGeometry.priceLines[0].segment.a.y, 175);
  assert.equal(squareGeometry.timeLines[0].segment.a.x, 125);
  assert.equal(squareGeometry.angleLines.length, 2);

  const box = fixture("gannBox");
  box.gann = {
    ...structuredClone(DEFAULT_GANN_BOX_CONFIG),
    priceLevels: [{ value: 0.5, enabled: true }],
    timeLevels: [{ value: 0.5, enabled: true }],
    angles: true,
  };
  const boxGeometry = projectGannGrid(box, "box", toX, toY)!;
  assert.equal(boxGeometry.priceLines.length, 1);
  assert.equal(boxGeometry.timeLines.length, 1);
  assert.ok(boxGeometry.angleLines.length >= 4);
});

test("Gann grid renderer applies independent level color, opacity, width, and style", () => {
  const drawing = fixture("gannSquare");
  drawing.fillColor = "transparent";
  drawing.gann = {
    ...structuredClone(DEFAULT_GANN_SQUARE_CONFIG),
    useOneColor: false,
    background: false,
    showFan: false,
    showArcs: false,
    priceLevels: [{
      value: 0.5,
      enabled: true,
      color: "#f23645",
      opacity: 0.35,
      lineWidth: 5,
      lineStyle: "dotted",
    }],
    timeLevels: [{
      value: 0.25,
      enabled: true,
      color: "#26a69a",
      opacity: 0.7,
      lineWidth: 3,
      lineStyle: "dashed",
    }],
  };
  const recording = strokeRecordingContext();
  getTool("gannSquare")!.render(recording.context, drawing, {
    toX,
    toY,
    width: 800,
    height: 600,
  }, false);
  assert.deepEqual(recording.strokes.slice(0, 2), [
    { color: "#f23645", opacity: 0.35, width: 5, dash: [2, 3] },
    { color: "#26a69a", opacity: 0.7, width: 3, dash: [6, 3] },
  ]);
});

test("Gann Square hit testing follows visible toggles rather than hidden grid lines", () => {
  const adapter = getTool("gannSquare")!;
  const drawing = fixture("gannSquare");
  drawing.gann = {
    ...structuredClone(DEFAULT_GANN_SQUARE_CONFIG),
    showLevels: false,
    showFan: false,
    showArcs: false,
  };
  assert.equal(
    adapter.hitTest(drawing, 150, 150, toX, toY).some((hit) => hit.target === "body"),
    false,
  );
  drawing.gann = {
    ...drawing.gann,
    showLevels: true,
    priceLevels: [{ value: 0.5, enabled: true }],
    timeLevels: [],
  };
  assert.equal(
    adapter.hitTest(drawing, 150, 150, toX, toY).some((hit) => hit.target === "body"),
    true,
  );
  drawing.gann = {
    ...drawing.gann,
    priceLevels: [{ value: 2, enabled: true }],
  };
  const bounds = adapter.boundingBox(drawing, toX, toY)!;
  assert.ok(bounds.y + bounds.h > 300, "external Gann levels must participate in culling bounds");
});

test("price/bar locking uses logical bars across market-session gaps", () => {
  const context = {
    barIntervalSeconds: 60,
    candles: [
      { time: 0 },
      { time: 60 },
      { time: 120 },
      { time: 600 },
      { time: 660 },
    ],
  };
  const first = { time: 120, price: 100 };
  const second = { time: 600, price: 110 };
  assert.equal(gannLogicalBars(first, second, context), 1);
  assert.equal(gannPriceBarRatio(first, second, context), 10);
  assert.deepEqual(
    constrainGannAnchor(first, { time: 660, price: 999 }, 10, context, 1),
    { time: 660, price: 120 },
  );
  const drawing = fixture("gannSquare");
  drawing.gann = {
    ...structuredClone(DEFAULT_GANN_SQUARE_CONFIG),
    scaleLock: false,
  };
  const constrained = constrainGannResize(
    drawing,
    "square",
    [first, second],
    1,
    { time: 660, price: 999 },
    context,
    true,
  );
  assert.equal(constrained?.priceBarRatio, 10);
  assert.equal(constrained?.point.price, 120);
  assert.equal(constrained?.gann.family, "square");

  const locked = setGannScaleLock(
    drawing.gann,
    [first, second],
    true,
    context,
  );
  assert.equal(locked.scaleLock, true);
  assert.equal(locked.priceBarRatio, 10);
  const unlocked = setGannScaleLock(locked, [first, second], false, context);
  assert.equal(unlocked.scaleLock, false);
  assert.equal(unlocked.priceBarRatio, 10, "unlocking retains the captured ratio");

  const degenerate = setGannScaleLock(
    { ...structuredClone(DEFAULT_GANN_SQUARE_CONFIG), priceBarRatio: 7 },
    [first, first],
    true,
    context,
  );
  assert.equal(degenerate.priceBarRatio, 7, "zero-bar geometry keeps the prior ratio");
});

test("codec sanitizes explicit Gann payloads and keeps payload-less legacy drawings", () => {
  const decoded = decodeDrawing({
    ...fixture("gannFan"),
    gann: {
      family: "fan",
      scaleLock: true,
      priceBarRatio: 2,
      ratios: [{ ratio: 1, label: "1/1", enabled: true, opacity: -2 }],
    },
  }).drawing!;
  assert.equal(decoded.gann?.family, "fan");
  assert.equal(decoded.gann?.priceBarRatio, 2);
  if (decoded.gann?.family === "fan") assert.equal(decoded.gann.ratios[0].opacity, 0);

  const legacy = decodeDrawing(fixture("gannBox")).drawing!;
  assert.equal(legacy.gann, undefined);

  const styled = decodeDrawing({
    ...fixture("gannBox"),
    gann: {
      ...structuredClone(DEFAULT_GANN_BOX_CONFIG),
      useOneColor: false,
      priceLevels: [{
        value: 0.5,
        enabled: true,
        color: "#f23645",
        opacity: 0.35,
        lineWidth: 5,
        lineStyle: "dotted",
      }],
      timeLevels: [{
        value: 0.25,
        enabled: true,
        color: "#26a69a",
        opacity: 0.7,
        lineWidth: 3,
        lineStyle: "dashed",
      }],
    },
  }).drawing!;
  assert.equal(styled.gann?.family, "box");
  if (styled.gann?.family === "box") {
    assert.equal(styled.gann.useOneColor, false);
    assert.deepEqual(styled.gann.priceLevels[0], {
      value: 0.5,
      enabled: true,
      color: "#f23645",
      opacity: 0.35,
      lineWidth: 5,
      lineStyle: "dotted",
    });
    assert.deepEqual(styled.gann.timeLevels[0], {
      value: 0.25,
      enabled: true,
      color: "#26a69a",
      opacity: 0.7,
      lineWidth: 3,
      lineStyle: "dashed",
    });
  }
});

test("tool defaults and cross-family templates resolve through the target Gann family", () => {
  const defaults = resolveDrawingCreationDefaults(
    "gannFan",
    {
      gann: {
        ...structuredClone(DEFAULT_GANN_FAN_CONFIG),
        priceBarRatio: Number.NaN,
      },
    },
    "#fff",
  );
  assert.equal(defaults.gann?.family, "fan");
  assert.equal(defaults.gann?.priceBarRatio, 1);

  const patch = applyDrawingTemplateStyle("gannBox", {
    gann: structuredClone(DEFAULT_GANN_SQUARE_CONFIG),
  });
  assert.equal(patch.gann?.family, "box");
  assert.deepEqual(patch.gann, structuredClone(DEFAULT_GANN_BOX_CONFIG));

  const styledBox = structuredClone(DEFAULT_GANN_BOX_CONFIG);
  styledBox.useOneColor = false;
  styledBox.priceLevels = [{
    value: 0.5,
    enabled: true,
    color: "#f23645",
    opacity: 0.25,
    lineWidth: 4,
    lineStyle: "dashed",
  }];
  const styledPatch = applyDrawingTemplateStyle("gannBox", { gann: styledBox });
  assert.equal(styledPatch.gann?.family, "box");
  if (styledPatch.gann?.family === "box") {
    assert.deepEqual(styledPatch.gann.priceLevels, styledBox.priceLevels);
  }
});
