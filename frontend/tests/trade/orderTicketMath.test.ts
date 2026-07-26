import assert from "node:assert/strict";
import { test } from "node:test";

import { computeRisk } from "../../src/services/tradeEngine";
import {
  formatTicketRatio,
  formatTicketSize,
  parseTicketNumber,
  ticketLotOverride,
} from "../../src/components/trade/tradeTicketMath";

test("trade ticket parses formatted prices with thousands separators", () => {
  assert.equal(parseTicketNumber("62,751.61"), 62751.61);
  assert.equal(parseTicketNumber("  2,500.00  "), 2500);
  assert.equal(parseTicketNumber(""), undefined);
  assert.equal(parseTicketNumber("abc"), undefined);
});

test("limit ticket metrics stay finite when prefilled prices contain commas", () => {
  const entry = parseTicketNumber("62,751.61");
  const stopLoss = parseTicketNumber("62,124.09");
  const takeProfit = parseTicketNumber("63,379.12");

  const metrics = computeRisk(
    {
      side: "long",
      price: entry,
      stopLoss,
      takeProfit,
      riskPct: 25,
    },
    62776,
    10_000,
  );

  assert.equal(Number.isFinite(metrics.positionSize), true);
  assert.equal(Number.isFinite(metrics.rewardAmount), true);
  assert.equal(Number.isFinite(metrics.riskReward), true);
  assert.equal(formatTicketSize(metrics.positionSize), "3.9839");
  assert.equal(formatTicketRatio(metrics.riskReward), "1.00");
});

test("risk math and ticket formatters do not surface NaN for invalid drafts", () => {
  const metrics = computeRisk(
    {
      side: "long",
      price: Number.NaN,
      stopLoss: Number.NaN,
      takeProfit: Number.NaN,
      riskPct: Number.NaN,
    },
    62776,
    10_000,
  );

  assert.equal(formatTicketSize(metrics.positionSize), "0.1593");
  assert.equal(metrics.rewardAmount, 0);
  assert.equal(formatTicketRatio(metrics.riskReward), "-");
});

test("risk percent owns sizing in auto mode and manual mode is explicit", () => {
  assert.equal(ticketLotOverride("auto", "0.01"), undefined);
  assert.equal(ticketLotOverride("manual", "0.01"), 0.01);
});
