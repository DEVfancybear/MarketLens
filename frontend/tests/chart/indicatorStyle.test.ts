import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCommonSeriesStyle,
  indicatorResultValueText,
  STYLE_LABELS_ON_PRICE_SCALE_KEY,
} from "../../src/services/indicatorStyle";
import type { IndicatorSeries } from "../../src/types";

describe("indicator style output flags", () => {
  it("preserves backend-hidden price labels for helper line segments", () => {
    const series: IndicatorSeries = {
      key: "Oversold color:1",
      color: "#ef4444",
      type: "line",
      lastValueVisible: false,
      data: [
        { time: 1, value: 25 },
        { time: 2, value: 20 },
      ],
    };

    const styled = applyCommonSeriesStyle(series, {
      [STYLE_LABELS_ON_PRICE_SCALE_KEY]: true,
    });

    assert.equal(styled.lastValueVisible, false);
  });

  it("keeps hidden helper segments out of the status line", () => {
    const text = indicatorResultValueText({
      id: "better-rsi",
      series: [
        {
          key: "RSI",
          color: "#fff",
          type: "line",
          data: [
            { time: 1, value: 45 },
            { time: 2, value: 55 },
          ],
        },
        {
          key: "Oversold color:1",
          color: "#ef4444",
          type: "line",
          statusLineVisible: false,
          data: [
            { time: 1, value: 25 },
            { time: 2, value: 20 },
          ],
        },
      ],
    });

    assert.equal(text, "55");
  });
});
