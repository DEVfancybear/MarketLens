import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  indicatorResultValueText,
} from "../../src/services/indicatorStyle";

describe("indicator style output flags", () => {
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
