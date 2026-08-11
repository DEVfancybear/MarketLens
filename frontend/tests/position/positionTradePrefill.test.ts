import assert from "node:assert/strict";
import { test } from "node:test";

import type { Drawing } from "../../src/types/drawing";
import {
  buildOrderPrefillFromPositionDrawing,
  inferPositionOrderType,
} from "../../src/components/chart/drawing/tools/positionTradePrefill";
import type { Mt5SymbolInfo } from "../../src/types/mt5";

const symbolInfo: Mt5SymbolInfo = {
  chartSymbol: "TEST",
  brokerSymbol: "TEST",
  digits: 2,
  point: 0.01,
  tickSize: 1,
  tickValue: 1,
  minLot: 0.01,
  maxLot: 100,
  lotStep: 0.01,
  tradeMode: "full",
  updatedAt: 0,
};

function position(tool: "long" | "short", id = "dw-test"): Drawing {
  return {
    id,
    tool,
    color: "#089981",
    lineWidth: 1,
    accountSize: 1000,
    riskUnit: "%",
    riskValue: 2.5,
    points:
      tool === "long"
        ? [
            { time: 1000, price: 100 },
            { time: 1020, price: 110 },
            { time: 1020, price: 90 },
          ]
        : [
            { time: 1000, price: 100 },
            { time: 1020, price: 90 },
            { time: 1020, price: 110 },
          ],
  };
}

test("position order type follows side and entry relative to market", () => {
  assert.equal(inferPositionOrderType("long", 99, 100), "limit");
  assert.equal(inferPositionOrderType("long", 101, 100), "stop");
  assert.equal(inferPositionOrderType("short", 101, 100), "limit");
  assert.equal(inferPositionOrderType("short", 99, 100), "stop");
});

test("long position drawing fills trade ticket with entry, stop, target and risk", () => {
  assert.deepEqual(buildOrderPrefillFromPositionDrawing(position("long"), 101), {
    source: "position-drawing",
    drawingId: "dw-test",
    side: "long",
    type: "limit",
    price: 100,
    stopLoss: 90,
    takeProfit: 110,
    riskPct: 2.5,
  });
});

test("short position drawing fills reversed stop and target", () => {
  assert.deepEqual(buildOrderPrefillFromPositionDrawing(position("short"), 99), {
    source: "position-drawing",
    drawingId: "dw-test",
    side: "short",
    type: "limit",
    price: 100,
    stopLoss: 110,
    takeProfit: 90,
    riskPct: 2.5,
  });
});

test("position prefill keeps the source drawing id for multi-position charts", () => {
  assert.equal(
    buildOrderPrefillFromPositionDrawing(position("long", "dw-long-a"), 101)
      ?.drawingId,
    "dw-long-a",
  );
  assert.equal(
    buildOrderPrefillFromPositionDrawing(position("short", "dw-short-b"), 99)
      ?.drawingId,
    "dw-short-b",
  );
});

test("position prefill includes lot quantity from account risk and SL distance", () => {
  assert.deepEqual(
    buildOrderPrefillFromPositionDrawing(position("long"), 101, { symbolInfo }),
    {
      source: "position-drawing",
      drawingId: "dw-test",
      side: "long",
      type: "limit",
      price: 100,
      stopLoss: 90,
      takeProfit: 110,
      riskPct: 2.5,
      quantity: 2.5,
    },
  );
});

test("position prefill leaves default risk sizing to the selected account", () => {
  const drawing = position("long");
  drawing.riskValue = 1;
  drawing.riskValueDefaulted = true;

  assert.deepEqual(
    buildOrderPrefillFromPositionDrawing(drawing, 101, { symbolInfo }),
    {
      source: "position-drawing",
      drawingId: "dw-test",
      side: "long",
      type: "limit",
      price: 100,
      stopLoss: 90,
      takeProfit: 110,
      riskPct: 1,
      riskPctIsDefault: true,
    },
  );
});

test("position prefill treats the historical 25 percent value as a default", () => {
  const drawing = position("long");
  drawing.riskValue = 25;

  const prefill = buildOrderPrefillFromPositionDrawing(drawing, 101, {
    symbolInfo,
  });
  assert.equal(prefill?.riskPctIsDefault, true);
  assert.equal(prefill?.quantity, undefined);
});

test("position prefill applies the same TradingView leverage cap as chart labels", () => {
  const drawing = position("long");
  drawing.riskValue = 100;
  drawing.leverage = 1;
  assert.equal(
    buildOrderPrefillFromPositionDrawing(drawing, 101, { symbolInfo })?.quantity,
    10,
  );
});

test("position prefill rejects drawings without the manifest position-side capability", () => {
  const drawing: Drawing = {
    ...position("long"),
    tool: "trendline",
  };
  assert.equal(buildOrderPrefillFromPositionDrawing(drawing, 101), null);
});
