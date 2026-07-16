import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing, DrawingDataSample } from "../../src/types/drawing";
import {
  DEFAULT_REGRESSION_TREND_CONFIG,
  resolveRegressionTrendConfig,
} from "../../src/types/regressionTrend";
import {
  regressionChannel,
  regressionSourceValue,
} from "../../src/components/chart/drawing/data/dataDrivenGeometry";
import {
  projectRegressionTrendGeometry,
} from "../../src/components/chart/drawing/tools/plugins/DataDrivenTools";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";

const sample: DrawingDataSample = {
  time: 1,
  open: 2,
  high: 10,
  low: 0,
  close: 6,
  volume: 1,
};

const sourceCases = [
  ["open", 2],
  ["high", 10],
  ["low", 0],
  ["close", 6],
  ["hl2", 5],
  ["hlc3", 16 / 3],
  ["ohlc4", 4.5],
  ["hlcc4", 5.5],
] as const;

test("Regression Trend resolves legacy defaults and every TradingView source", () => {
  assert.deepEqual(
    resolveRegressionTrendConfig(undefined),
    DEFAULT_REGRESSION_TREND_CONFIG,
  );
  for (const [source, expected] of sourceCases) {
    assert.equal(regressionSourceValue(sample, source), expected, source);
  }
  assert.deepEqual(
    resolveRegressionTrendConfig({
      regressionUpperDeviation: Number.NaN,
      regressionLowerDeviation: Number.POSITIVE_INFINITY,
      regressionSource: "future" as never,
    }),
    DEFAULT_REGRESSION_TREND_CONFIG,
  );
});

test("Regression Trend deviation and Pearson math use the selected source", () => {
  const samples: DrawingDataSample[] = [0, 2, 1].map((close, index) => ({
    time: index + 1,
    open: 10 + index * 3,
    high: 20 + index * 4,
    low: 5 + index,
    close,
    volume: 1,
  }));
  const close = regressionChannel(samples, {
    regressionSource: "close",
    regressionUpperDeviation: 3,
    regressionLowerDeviation: -1,
  });
  assert.equal(close.slope, 0.5);
  assert.equal(close.intercept, 0.5);
  assert.ok(Math.abs(close.deviation - Math.sqrt(0.5)) < 1e-12);
  assert.ok(Math.abs(close.correlation - 0.5) < 1e-12);
  assert.deepEqual(close.sourceValues, [0, 2, 1]);
  assert.ok(
    Math.abs(close.upperValues[0] - (0.5 + Math.sqrt(0.5) * 3)) < 1e-12,
  );
  assert.ok(
    Math.abs(close.lowerValues[0] - (0.5 - Math.sqrt(0.5))) < 1e-12,
  );

  const high = regressionChannel(samples, { regressionSource: "high" });
  assert.equal(high.slope, 4);
  assert.deepEqual(high.sourceValues, [20, 24, 28]);
  assert.equal(high.correlation, 1);

  const noDeviations = regressionChannel(samples, {
    regressionUseUpperDeviation: false,
    regressionUseLowerDeviation: false,
  });
  assert.deepEqual(noDeviations.upperValues, []);
  assert.deepEqual(noDeviations.lowerValues, []);
});

function fixture(patch: Partial<Drawing> = {}): Drawing {
  // Keep the default +/-2 deviation channels outside the shared 20 px hit
  // tolerance so visibility assertions cannot accidentally hit the base line.
  const closes = [0, 40, 0];
  return {
    id: "regression-1",
    tool: "regressionTrend",
    color: "#2962ff",
    lineWidth: 2,
    points: [
      { time: 100, price: 100 },
      { time: 300, price: 100 },
    ],
    dataSnapshot: {
      version: 1,
      symbol: "TEST",
      capturedAt: 1,
      samples: closes.map((close, index) => ({
        time: 100 + index * 100,
        open: close,
        high: close + 2,
        low: close - 2,
        close,
        volume: 1,
      })),
    },
    ...patch,
  };
}

function recordingContext() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
    measureText: (text: string) => ({ width: text.length * 7 }),
  };
  const context = new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property as string];
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
      };
    },
    set(object, property, value) {
      object[property as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

const projector = {
  toX: (value: number) => value,
  toY: (value: number) => value,
  width: 800,
  height: 600,
};

test("Regression Trend adapter shares enabled projection across render, hit, and bounds", () => {
  const adapter = getTool("regressionTrend");
  assert.ok(adapter);
  const drawing = fixture();
  const geometry = projectRegressionTrendGeometry(
    drawing,
    projector.toX,
    projector.toY,
  );
  assert.ok(geometry.base && geometry.upper && geometry.lower && geometry.pearson);
  assert.deepEqual(geometry.anchorPoints, [geometry.base.a, geometry.base.b]);
  assert.notEqual(
    geometry.base.a.y,
    projector.toY(drawing.points[0].price),
    "Regression is calculated at the selected source values, not shifted to pointer price",
  );

  const upperMid = {
    x: (geometry.upper.a.x + geometry.upper.b.x) / 2,
    y: (geometry.upper.a.y + geometry.upper.b.y) / 2,
  };
  assert.ok(
    adapter
      .hitTest(drawing, upperMid.x, upperMid.y, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
  );
  const bounds = adapter.boundingBox(drawing, projector.toX, projector.toY);
  assert.ok(bounds);
  for (const point of [geometry.base.a, geometry.base.b, geometry.upper.a, geometry.lower.b]) {
    assert.ok(point.x >= bounds.x && point.x <= bounds.x + bounds.w);
    assert.ok(point.y >= bounds.y && point.y <= bounds.y + bounds.h);
  }

  const recorded = recordingContext();
  adapter.render(recorded.context, drawing, projector, false);
  assert.equal(recorded.calls.filter((call) => call.method === "stroke").length, 3);
  assert.deepEqual(
    recorded.calls.filter((call) => call.method === "fillText").map((call) => call.args[0]),
    ["R 0.00"],
  );
});

test("Regression Trend visibility, Pearson, and extension settings affect every adapter surface", () => {
  const adapter = getTool("regressionTrend");
  assert.ok(adapter);
  const baseline = fixture();
  const baselineUpper = projectRegressionTrendGeometry(
    baseline,
    projector.toX,
    projector.toY,
  ).upper!;
  const upperMid = {
    x: (baselineUpper.a.x + baselineUpper.b.x) / 2,
    y: (baselineUpper.a.y + baselineUpper.b.y) / 2,
  };
  const hiddenUpper = fixture({
    regressionShowUpperLine: false,
    regressionShowPearsonR: false,
  });
  const hiddenGeometry = projectRegressionTrendGeometry(
    hiddenUpper,
    projector.toX,
    projector.toY,
  );
  assert.equal(hiddenGeometry.upper, null);
  assert.equal(hiddenGeometry.pearson, null);
  assert.equal(
    adapter
      .hitTest(hiddenUpper, upperMid.x, upperMid.y, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
    false,
  );
  const hiddenRecorded = recordingContext();
  adapter.render(hiddenRecorded.context, hiddenUpper, projector, false);
  assert.equal(hiddenRecorded.calls.filter((call) => call.method === "stroke").length, 2);
  assert.equal(hiddenRecorded.calls.filter((call) => call.method === "fillText").length, 0);

  const extended = fixture({ regressionExtendLines: true });
  const extendedGeometry = projectRegressionTrendGeometry(
    extended,
    projector.toX,
    projector.toY,
  );
  assert.ok(extendedGeometry.base);
  const finiteGeometry = projectRegressionTrendGeometry(
    baseline,
    projector.toX,
    projector.toY,
  );
  assert.ok(finiteGeometry.base);
  assert.deepEqual(extendedGeometry.base.a, finiteGeometry.base.a);
  assert.ok(extendedGeometry.base.b.x > finiteGeometry.base.b.x);
  const extendedBounds = adapter.boundingBox(
    extended,
    projector.toX,
    projector.toY,
  );
  assert.ok(extendedBounds && extendedBounds.w > 100_000);
  const farPoint = {
    x: extendedGeometry.base.a.x +
      (extendedGeometry.base.b.x - extendedGeometry.base.a.x) * 0.25,
    y: extendedGeometry.base.a.y +
      (extendedGeometry.base.b.y - extendedGeometry.base.a.y) * 0.25,
  };
  assert.ok(
    adapter
      .hitTest(extended, farPoint.x, farPoint.y, projector.toX, projector.toY)
      .some((hit) => hit.target === "body"),
  );
});

test("Regression Trend remains chronological when anchors were created right-to-left", () => {
  const leftToRight = projectRegressionTrendGeometry(
    fixture(),
    projector.toX,
    projector.toY,
  );
  const rightToLeft = projectRegressionTrendGeometry(
    fixture({
      points: [
        { time: 300, price: 9_999 },
        { time: 100, price: -9_999 },
      ],
    }),
    projector.toX,
    projector.toY,
  );
  assert.deepEqual(rightToLeft.base, leftToRight.base);
  assert.deepEqual(
    rightToLeft.anchorPoints,
    [rightToLeft.base!.b, rightToLeft.base!.a],
    "p1/p2 handles retain creation order while the regression stays chronological",
  );
});
