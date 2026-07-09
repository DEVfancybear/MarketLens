import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAIN_PRICE_SCALE_MARGINS,
  PRICE_SCALE_MIN_WIDTH,
  RIGHT_OFFSET_BARS,
  timeScaleDefaults,
  timeScaleOptions,
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

test("whitespace replacement does not auto-shift a user-panned viewport", () => {
  assert.equal(
    timeScaleOptions("dark", "15m").allowShiftVisibleRangeOnWhitespaceReplacement,
    false,
  );
});
