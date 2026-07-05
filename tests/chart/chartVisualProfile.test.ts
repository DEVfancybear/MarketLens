import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAIN_PRICE_SCALE_MARGINS,
  PRICE_SCALE_MIN_WIDTH,
  RIGHT_OFFSET_BARS,
  VOLUME_PRICE_SCALE_MARGINS,
  timeScaleDefaults,
} from "../../src/components/chart/chartVisualProfile";

test("main chart keeps TradingView-like right offset and price scale width", () => {
  const defaults = timeScaleDefaults("15m");

  assert.equal(defaults.rightOffset, RIGHT_OFFSET_BARS);
  assert.equal(defaults.minBarSpacing > 0, true);
  assert.equal(PRICE_SCALE_MIN_WIDTH >= 70, true);
});

test("volume stays in a shallow bottom overlay", () => {
  assert.equal(MAIN_PRICE_SCALE_MARGINS.bottom < 0.2, true);
  assert.equal(VOLUME_PRICE_SCALE_MARGINS.top >= 0.85, true);
  assert.equal(VOLUME_PRICE_SCALE_MARGINS.bottom, 0);
});
