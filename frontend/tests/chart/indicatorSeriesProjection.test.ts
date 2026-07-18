import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  indicatorSeriesDataForCandles,
  indicatorSeriesDataThroughCutoff,
} from "../../src/services/indicatorSeriesProjection";
import type { Candle, IndicatorSeries } from "../../src/types";

const candles: Candle[] = [
  { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 },
  { time: 200, open: 2, high: 3, low: 1.5, close: 2.5, volume: 1 },
  { time: 300, open: 3, high: 4, low: 2.5, close: 3.5, volume: 1 },
];

describe("indicator series viewport projection", () => {
  it("extends marked reference lines to the current candle range", () => {
    const series: IndicatorSeries = {
      key: "High",
      color: "#fff",
      type: "line",
      extendToVisibleRange: true,
      data: [
        { time: 10, value: 70 },
        { time: 20, value: 70 },
      ],
    };

    assert.deepEqual(indicatorSeriesDataForCandles(series, candles), [
      { time: 100, value: 70 },
      { time: 300, value: 70 },
    ]);
  });

  it("does not extend dynamic plots or line-break helper segments", () => {
    const series: IndicatorSeries = {
      key: "Oversold color:1",
      color: "#ef4444",
      type: "line",
      statusLineVisible: false,
      lastValueVisible: false,
      data: [
        { time: 100, value: 29 },
        { time: 200, value: 18 },
      ],
    };

    assert.deepEqual(indicatorSeriesDataForCandles(series, candles), series.data);
  });

  it("extends marked reference lines through right-offset whitespace", () => {
    const series: IndicatorSeries = {
      key: "Background color",
      color: "rgba(255,0,255,0.1)",
      type: "baselineFill",
      baseValue: 30,
      extendToVisibleRange: true,
      data: [
        { time: 100, value: 70 },
        { time: 300, value: 70 },
      ],
    };

    assert.deepEqual(indicatorSeriesDataForCandles(series, candles, { from: 1, to: 5 }), [
      { time: 200, value: 70 },
      { time: 600, value: 70 },
    ]);
  });

  it("clips a crossing future extension at the replay cutoff", () => {
    assert.deepEqual(
      indicatorSeriesDataThroughCutoff(
        [
          { time: 100, value: 70 },
          { time: 600, value: 70 },
        ],
        300,
      ),
      [
        { time: 100, value: 70 },
        { time: 300, value: 70 },
      ],
    );
  });

  it("drops indicator geometry that exists only after the replay cutoff", () => {
    assert.deepEqual(
      indicatorSeriesDataThroughCutoff(
        [
          { time: 400, value: 70 },
          { time: 600, value: 70 },
        ],
        300,
      ),
      [],
    );
  });

  it("does not synthesize a boundary sample for discrete histograms", () => {
    assert.deepEqual(
      indicatorSeriesDataThroughCutoff(
        [
          { time: 100, value: 7 },
          { time: 600, value: 9 },
        ],
        300,
        false,
      ),
      [{ time: 100, value: 7 }],
    );
  });
});
