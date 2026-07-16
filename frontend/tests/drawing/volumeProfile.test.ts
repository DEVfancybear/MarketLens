import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing, DrawingDataSample } from "../../src/types/drawing";
import {
  calculateVolumeProfile,
} from "../../src/components/chart/drawing/data/dataDrivenGeometry";
import {
  projectVolumeProfileGeometry,
} from "../../src/components/chart/drawing/tools/plugins/DataDrivenTools";
import { getTool } from "../../src/components/chart/drawing/tools/ToolRegistry";
import { resolveVolumeProfileConfig } from "../../src/types/volumeProfile";
import { measuredCumulativeVolumeDelta } from "../../src/services/market-data/quoteVolume";
import { selectCompleteLowerTimeframeCandidate } from "../../src/components/chart/drawing/data/volumeProfileDetail";
import { loadCompleteVolumeProfileHistory } from "../../src/components/chart/drawing/data/volumeProfileHistory";

function chartBar(
  time: number,
  volume: number,
  patch: Partial<DrawingDataSample> = {},
): DrawingDataSample {
  return {
    time,
    open: 10,
    high: 20,
    low: 0,
    close: 15,
    volume,
    ...patch,
  };
}

test("volume profile distributes complete lower-timeframe bars across touched rows", () => {
  const result = calculateVolumeProfile([
    chartBar(1, 40, {
      subBars: [{
        time: 1,
        open: 0,
        high: 4,
        low: 0,
        close: 4,
        volume: 40,
      }],
      subBarsComplete: true,
    }),
  ], 4);

  assert.equal(result.metadata.source, "lower-timeframe");
  assert.equal(result.metadata.observationCount, 1);
  assert.equal(result.metadata.totalVolume, 40);
  assert.deepEqual(result.bins.map((bin) => bin.volume), [10, 10, 10, 10]);
  assert.deepEqual(result.bins.map((bin) => bin.upVolume), [10, 10, 10, 10]);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.downVolume, 0), 0);
});

test("volume profile uses one complete source and deterministically falls back to chart bars", () => {
  const completeTicks = calculateVolumeProfile([
    chartBar(1, 100, {
      ticks: [
        { price: 1, volume: 2, direction: "up" },
        { price: 2 },
      ],
      ticksComplete: true,
    }),
    chartBar(2, 200, {
      ticks: [{ price: 1.5, volume: 3 }],
      ticksComplete: true,
    }),
  ], 3);
  assert.equal(completeTicks.metadata.source, "ticks");
  assert.equal(completeTicks.metadata.totalVolume, 6);
  assert.equal(
    completeTicks.bins.reduce((sum, bin) => sum + bin.upVolume, 0),
    3,
  );
  assert.equal(
    completeTicks.bins.reduce((sum, bin) => sum + bin.downVolume, 0),
    3,
  );

  const incompleteDetail = calculateVolumeProfile([
    chartBar(1, 100, {
      subBars: [{
        time: 1,
        open: 1,
        high: 2,
        low: 1,
        close: 2,
        volume: 1,
      }],
    }),
    chartBar(2, 200),
  ], 4);
  assert.equal(incompleteDetail.metadata.source, "chart-timeframe");
  assert.equal(incompleteDetail.metadata.totalVolume, 300);
  assert.equal(incompleteDetail.metadata.observationCount, 2);

  const boundedTicks = calculateVolumeProfile([
    chartBar(1, 7, {
      ticks: [{ price: 1, volume: 1 }],
      ticksComplete: false,
      subBars: [{
        time: 1,
        open: 2,
        high: 3,
        low: 2,
        close: 3,
        volume: 7,
      }],
      subBarsComplete: true,
    }),
  ], 2);
  assert.equal(boundedTicks.metadata.source, "lower-timeframe");
  assert.equal(boundedTicks.metadata.totalVolume, 7);
});

test("unit-volume ticks do not displace complete OHLCV detail", () => {
  const samples = [0, 300].map((time, parentIndex) =>
    chartBar(time, 1_000, {
      subBars: Array.from({ length: 5 }, (_, index) => ({
        time: time + index * 60,
        open: 10 + parentIndex,
        high: 11 + parentIndex,
        low: 9 + parentIndex,
        close: 10.5 + parentIndex,
        volume: 10,
      })),
      subBarsComplete: true,
      ticks: [{ time: time + 30, price: 10 + parentIndex }],
      ticksComplete: true,
    })
  );

  const unitTicks = calculateVolumeProfile(samples, 4);
  assert.equal(unitTicks.metadata.source, "lower-timeframe");
  assert.equal(unitTicks.metadata.totalVolume, 100);

  samples[0].ticks![0].volume = 4;
  const mixedTicks = calculateVolumeProfile(samples, 4);
  assert.equal(mixedTicks.metadata.source, "lower-timeframe");
  assert.equal(mixedTicks.metadata.totalVolume, 100);

  samples[1].ticks![0].volume = 6;
  const measuredTicks = calculateVolumeProfile(samples, 4);
  assert.equal(measuredTicks.metadata.source, "ticks");
  assert.equal(measuredTicks.metadata.totalVolume, 10);
});

test("measured ticks without explicit interval coverage never displace chart data", () => {
  const result = calculateVolumeProfile([
    chartBar(0, 100, {
      ticks: [{ time: 30, price: 12, volume: 4 }],
    }),
    chartBar(300, 200, {
      ticks: [{ time: 330, price: 13, volume: 6 }],
    }),
  ], 4);
  assert.equal(result.metadata.source, "chart-timeframe");
  assert.equal(result.metadata.totalVolume, 300);
});

test("runtime rejects persisted lower-timeframe gaps even when legacy flags claim complete", () => {
  const samples = [
    chartBar(0, 100, {
      subBars: [0, 60].map((time) => ({
        time,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 1,
      })),
      subBarsComplete: true,
    }),
    chartBar(300, 200, {
      subBars: [300, 360, 420, 480, 540].map((time) => ({
        time,
        open: 10,
        high: 11,
        low: 9,
        close: 10.5,
        volume: 1,
      })),
      subBarsComplete: true,
    }),
  ];

  const result = calculateVolumeProfile(samples, 4);
  assert.equal(result.metadata.source, "chart-timeframe");
  assert.equal(result.metadata.totalVolume, 300);
});

test("session-day detail is complete when sub-bars conserve each parent volume", () => {
  const sessionOpen = 9.5 * 60 * 60;
  const samples = [0, 86_400].map((time, dayIndex) => {
    const volume = dayIndex === 0 ? 100 : 250;
    return chartBar(time, volume, {
      subBars: [
        {
          time: time + sessionOpen,
          open: 10 + dayIndex,
          high: 11 + dayIndex,
          low: 9 + dayIndex,
          close: 10.5 + dayIndex,
          volume: volume * 0.4,
        },
        {
          time: time + sessionOpen + 60,
          open: 10.5 + dayIndex,
          high: 12 + dayIndex,
          low: 10 + dayIndex,
          close: 11 + dayIndex,
          volume: volume * 0.6,
        },
      ],
      subBarsComplete: true,
    });
  });

  const result = calculateVolumeProfile(samples, 4);
  assert.equal(result.metadata.source, "lower-timeframe");
  assert.equal(result.metadata.observationCount, 4);
  assert.equal(result.metadata.totalVolume, 350);
});

test("quote-volume reconstruction keeps only positive measured deltas", () => {
  assert.equal(measuredCumulativeVolumeDelta(1_000, undefined), undefined);
  assert.equal(measuredCumulativeVolumeDelta(1_003.5, 1_000), 3.5);
  assert.equal(measuredCumulativeVolumeDelta(5, 1_003.5), undefined);
  assert.equal(measuredCumulativeVolumeDelta(0, 5), undefined);
});

test("volume-profile settings resolve to bounded deterministic defaults", () => {
  assert.deepEqual(
    resolveVolumeProfileConfig({
      volumeProfileRows: Number.NaN,
      volumeProfileValueAreaPercent: -5,
      volumeProfileWidthPercent: 500,
      volumeProfilePlacement: "middle" as never,
      volumeProfileVolumeMode: "future" as never,
    }),
    {
      volumeProfileRows: 24,
      volumeProfileValueAreaPercent: 0,
      volumeProfileWidthPercent: 100,
      volumeProfilePlacement: "right",
      volumeProfileVolumeMode: "up-down",
      volumeProfileShowHistogram: true,
      volumeProfileShowPointOfControl: true,
      volumeProfileShowValueAreaHigh: true,
      volumeProfileShowValueAreaLow: true,
    },
  );
});

test("single chart-bar fallback follows AVP/FRVP strict doji direction", () => {
  const result = calculateVolumeProfile([
    chartBar(1, 10, { open: 10, close: 10 }),
  ], 2);
  assert.equal(result.metadata.source, "chart-timeframe");
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.upVolume, 0), 0);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.downVolume, 0), 10);
});

test("POC and value area follow TradingView expansion and tie-breaking rules", () => {
  const result = calculateVolumeProfile([
    chartBar(1, 999, {
      ticks: [
        { price: 0, volume: 1, direction: "up" },
        { price: 1, volume: 4, direction: "up" },
        { price: 2, volume: 10, direction: "up" },
        { price: 3, volume: 4, direction: "up" },
        { price: 4, volume: 1, direction: "up" },
      ],
      ticksComplete: true,
    }),
  ], 5, 70);

  assert.deepEqual(result.bins.map((bin) => bin.volume), [1, 4, 10, 4, 1]);
  assert.equal(result.metadata.pointOfControlIndex, 2);
  assert.equal(result.metadata.pointOfControlPrice, 2);
  assert.equal(result.metadata.valueAreaLowIndex, 2);
  assert.equal(result.metadata.valueAreaHighIndex, 3);
  assert.equal(result.metadata.valueAreaVolume, 14);
  assert.deepEqual(
    result.bins.map((bin) => Boolean(bin.isValueArea)),
    [false, false, true, true, false],
  );
});

function profileDrawing(patch: Partial<Drawing> = {}): Drawing {
  return {
    id: "vp-1",
    tool: "fixedVolumeProfile",
    color: "#2962ff",
    fillColor: "#26a69a",
    lineWidth: 2,
    opacity: 0.6,
    points: [
      { time: 0, price: 1_000 },
      { time: 200, price: -1_000 },
    ],
    dataSnapshot: {
      version: 1,
      symbol: "TEST",
      capturedAt: 1,
      samples: [
        chartBar(0, 100, { open: 10, low: 10, high: 20, close: 20 }),
        chartBar(200, 50, { open: 20, low: 20, high: 30, close: 25 }),
      ],
    },
    volumeProfileRows: 4,
    ...patch,
  };
}

function recordingContext() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const target: Record<string, unknown> = {
    canvas: { width: 800, height: 600 },
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

test("profile adapter uses market prices, width/placement, POC/VA lines on every surface", () => {
  const drawing = profileDrawing();
  const geometry = projectVolumeProfileGeometry(
    drawing,
    projector.toX,
    projector.toY,
    false,
  );
  assert.equal(geometry.metadata.source, "chart-timeframe");
  assert.ok(geometry.rows.length > 0);
  assert.ok(Math.max(...geometry.rows.map((row) => row.y + row.h)) < 100);
  assert.equal(Math.max(...geometry.rows.map((row) => row.w)), 60);
  assert.equal(geometry.lines.filter((line) => line.kind === "poc").length, 1);
  assert.equal(geometry.lines.filter((line) => line.kind === "vah").length, 1);
  assert.equal(geometry.lines.filter((line) => line.kind === "val").length, 1);

  const adapter = getTool("fixedVolumeProfile");
  assert.ok(adapter);
  const recorded = recordingContext();
  adapter.render(recorded.context, drawing, projector, false);
  assert.ok(recorded.calls.some((call) => call.method === "fillRect"));
  assert.equal(
    recorded.calls.filter((call) => call.method === "stroke").length,
    3,
  );

  const poc = geometry.lines.find((line) => line.kind === "poc")!;
  assert.ok(
    adapter.hitTest(
      drawing,
      (poc.x1 + poc.x2) / 2,
      poc.y,
      projector.toX,
      projector.toY,
    ).some((hit) => hit.target === "body"),
  );
  const bounds = adapter.boundingBox(drawing, projector.toX, projector.toY);
  assert.ok(bounds);
  assert.ok(poc.x1 >= bounds.x && poc.x2 <= bounds.x + bounds.w);
  assert.ok(poc.y >= bounds.y && poc.y <= bounds.y + bounds.h);

  const left = projectVolumeProfileGeometry(
    profileDrawing({ volumeProfilePlacement: "left" }),
    projector.toX,
    projector.toY,
    false,
  );
  assert.ok(left.rows.every((row) => row.x === 0));
});

test("lower-timeframe selection skips partial fine data for complete coarser data", () => {
  const parents = [chartBar(0, 50), chartBar(300, 50)];
  const selected = selectCompleteLowerTimeframeCandidate(
    parents,
    300,
    [
      {
        id: "fine",
        bars: [0, 60, 300, 360].map((time) => chartBar(time, 10)),
      },
      {
        id: "coarse",
        bars: [0, 60, 120, 180, 240, 300, 360, 420, 480, 540]
          .map((time) => chartBar(time, 10)),
      },
    ],
  );
  assert.equal(selected?.id, "coarse");
  assert.equal(selected?.bars.length, 10);
});

test("normal history loading tries candidate timeframes until coverage is complete", async () => {
  const calls: string[] = [];
  const complete = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440, 1620]
    .map((time) => chartBar(time, 10));
  const result = await loadCompleteVolumeProfileHistory(
    {
      mode: "between-anchors",
      points: [{ time: 0, price: 1 }, { time: 900, price: 2 }],
      candles: [chartBar(0, 50), chartBar(900, 50)],
      symbol: "TEST",
      timeframe: "15m",
      capturedAt: 1_800,
    },
    async ({ timeframe }) => {
      calls.push(timeframe);
      if (timeframe === "1m") return [chartBar(0, 1)];
      if (timeframe === "3m") return complete;
      return [];
    },
  );
  assert.deepEqual(calls, ["1m", "3m"]);
  assert.equal(result?.length, 10);
});
