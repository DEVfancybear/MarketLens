import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAIN_PRICE_SCALE_MARGINS,
  PRICE_SCALE_MIN_WIDTH,
  RIGHT_OFFSET_BARS,
  VOLUME_TYPICAL_BAR_FRACTION,
  candlestickOptions,
  currentPriceMarkerIsUp,
  getDefaultBarSpacing,
  indicatorSeriesPriceFormatOptions,
  timeScaleDefaults,
  timeScaleOptions,
  timeScaleRuntimeOptions,
  volumeAutoscaleInfo,
  volumeScaleCeiling,
} from "../../src/components/chart/chartVisualProfile";

test("main chart keeps TradingView-like right offset and price scale width", () => {
  const defaults = timeScaleDefaults("15m");

  assert.equal(defaults.rightOffset, RIGHT_OFFSET_BARS);
  assert.equal(defaults.minBarSpacing > 0, true);
  assert.equal(PRICE_SCALE_MIN_WIDTH >= 70, true);
});

test("main chart does not reserve a default volume overlay band", () => {
  assert.equal(MAIN_PRICE_SCALE_MARGINS.bottom <= 0.1, true);
  assert.equal(MAIN_PRICE_SCALE_MARGINS.top <= 0.1, true);
});

test("all timeframes start with TradingView candle density and palette", () => {
  for (const timeframe of ["1m", "5m", "1H", "1D", "1M"] as const) {
    assert.equal(getDefaultBarSpacing(timeframe), 16);
  }

  const candles = candlestickOptions("dark", 5);
  assert.equal(candles.upColor, "#089981");
  assert.equal(candles.downColor, "#f23645");
  assert.equal(candles.wickUpColor, candles.upColor);
  assert.equal(candles.wickDownColor, candles.downColor);
  assert.equal(candles.borderVisible, false);
});

test("current price marker follows the active candle body, not the latest tick", () => {
  // A downtick that remains above the candle open is still bullish.
  assert.equal(currentPriceMarkerIsUp(101, 100), true);
  // An uptick that remains below the candle open is still bearish.
  assert.equal(currentPriceMarkerIsUp(99, 100), false);
  assert.equal(currentPriceMarkerIsUp(100, 100), true);
  assert.equal(currentPriceMarkerIsUp(100, undefined), true);
});

test("whitespace replacement does not auto-shift a user-panned viewport", () => {
  assert.equal(
    timeScaleOptions("dark", "15m").allowShiftVisibleRangeOnWhitespaceReplacement,
    false,
  );
});

test("runtime time-scale updates cannot perform an untracked viewport write", () => {
  const runtime = timeScaleRuntimeOptions("dark", "UTC");

  assert.equal("barSpacing" in runtime, false);
  assert.equal("rightOffset" in runtime, false);
  assert.equal("minBarSpacing" in runtime, false);
  assert.equal(runtime.allowShiftVisibleRangeOnWhitespaceReplacement, false);
});

test("runtime volume format uses the shared volume formatter", () => {
  assert.deepEqual(
    indicatorSeriesPriceFormatOptions({
      key: "volume",
      color: "#fff",
      data: [],
      type: "histogram",
      valueFormat: "volume",
    }),
    { priceFormat: { type: "volume" } },
  );
});

test("volume autoscale keeps typical bars at the common visual fraction", () => {
  const points = [40, 45, 50, 50, 55, 60, 120].map((value) => ({ value }));
  const ceiling = volumeScaleCeiling(points);
  assert.equal(ceiling, 50 / VOLUME_TYPICAL_BAR_FRACTION);
  assert.deepEqual(
    volumeAutoscaleInfo(
      { priceRange: { minValue: 6, maxValue: 120 } },
      ceiling,
    ),
    { priceRange: { minValue: 0, maxValue: 200 } },
  );
});

test("volume autoscale preserves real spikes above common headroom", () => {
  const ceiling = volumeScaleCeiling([10, 10, 10, 10, 60].map((value) => ({ value })));
  assert.deepEqual(
    volumeAutoscaleInfo(
      { priceRange: { minValue: 0, maxValue: 60 }, margins: { above: 2, below: 1 } },
      ceiling,
    ),
    { priceRange: { minValue: 0, maxValue: 60 }, margins: { above: 2, below: 1 } },
  );
});
