#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const positionTool = readFileSync(
  resolve(root, "src/components/chart/drawing/tools/plugins/PositionTool.ts"),
  "utf8",
);
const drawingLayer = readFileSync(
  resolve(root, "src/components/chart/DrawingLayer.tsx"),
  "utf8",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function persistedPositionHit(d) {
  if (
    !d.points[0] ||
    (d.tradeStatus !== "tp_hit" && d.tradeStatus !== "sl_hit") ||
    d.hitTime == null
  ) {
    return null;
  }
  const price =
    d.hitPrice ??
    (d.tradeStatus === "tp_hit"
      ? (d.points[1]?.price ?? d.target ?? d.points[0].price)
      : (d.points[2]?.price ?? d.stop ?? d.points[0].price));
  return {
    status: d.tradeStatus,
    time: d.points[0].time + d.hitTime,
    price,
  };
}

function coversEntry(d, candles) {
  const entry = d.points[0];
  return !!entry && candles.length > 0 && candles[0].time <= entry.time;
}

function detectPositionHit(d, candles) {
  const p0 = d.points[0];
  if (!p0 || candles.length === 0) return null;
  const entry = p0.price;
  const target = d.points[1]?.price ?? d.target ?? entry;
  const stop = d.points[2]?.price ?? d.stop ?? entry;
  const isLong = d.tool === "long";

  let filled = false;
  let firstBar = true;
  for (const candle of candles) {
    if (candle.time < p0.time) continue;
    if (!filled) {
      if (candle.low <= entry && entry <= candle.high) {
        filled = true;
        if (firstBar) {
          firstBar = false;
          continue;
        }
      } else {
        firstBar = false;
        continue;
      }
    }

    if (isLong) {
      if (candle.low <= stop) return { status: "sl_hit", time: candle.time, price: stop };
      if (candle.high >= target) return { status: "tp_hit", time: candle.time, price: target };
    } else {
      if (candle.high >= stop) return { status: "sl_hit", time: candle.time, price: stop };
      if (candle.low <= target) return { status: "tp_hit", time: candle.time, price: target };
    }
  }
  return null;
}

function resolvePositionHit(d, candles) {
  const persisted = persistedPositionHit(d);
  if (!coversEntry(d, candles)) return persisted;
  return detectPositionHit(d, candles);
}

function fixture() {
  return {
    id: "dw-test",
    tool: "long",
    points: [
      { time: 1000, price: 100 },
      { time: 1020, price: 110 },
      { time: 1020, price: 90 },
    ],
    tradeStatus: "sl_hit",
    hitTime: 20,
    hitPrice: 90,
  };
}

function checkStaticRegressionGuards() {
  assert(
    /export function resolvePositionHit/.test(positionTool),
    "PositionTool must export resolvePositionHit",
  );
  assert(
    /export function positionHitDataCoversEntry/.test(positionTool),
    "PositionTool must export positionHitDataCoversEntry",
  );
  assert(
    /resolvePositionHit/.test(drawingLayer),
    "DrawingLayer must use resolvePositionHit instead of raw detectPositionHit",
  );
  assert(
    !/const found = detectPositionHit\(d,/.test(drawingLayer),
    "DrawingLayer must not overwrite persisted hit state with raw detectPositionHit",
  );
}

function checkIncompleteReloadKeepsPersistedStop() {
  const d = fixture();
  const incompleteAfterReload = [
    { time: 1030, high: 111, low: 101 },
    { time: 1040, high: 112, low: 100 },
  ];
  const resolved = resolvePositionHit(d, incompleteAfterReload);
  assert(resolved?.status === "sl_hit", "incomplete reload data must keep persisted SL hit");
  assert(resolved?.price === 90, "persisted SL price must be preserved");
}

function checkCompleteHistoryStillCorrectsChronology() {
  const d = fixture();
  const complete = [
    { time: 1000, high: 101, low: 99 },
    { time: 1010, high: 105, low: 95 },
    { time: 1020, high: 106, low: 89 },
    { time: 1030, high: 111, low: 100 },
  ];
  const resolved = resolvePositionHit(d, complete);
  assert(resolved?.status === "sl_hit", "complete data must resolve first SL before later TP");
  assert(resolved?.time === 1020, "complete data must preserve chronological first hit");
}

function checkIncompleteWithoutPersistedDoesNotInventTakeProfit() {
  const d = { ...fixture(), tradeStatus: undefined, hitTime: undefined, hitPrice: undefined };
  const incompleteAfterReload = [{ time: 1030, high: 111, low: 101 }];
  const resolved = resolvePositionHit(d, incompleteAfterReload);
  assert(resolved == null, "incomplete reload data without persisted status must not invent TP");
}

checkStaticRegressionGuards();
checkIncompleteReloadKeepsPersistedStop();
checkCompleteHistoryStillCorrectsChronology();
checkIncompleteWithoutPersistedDoesNotInventTakeProfit();

console.log("[position-hit-resolution] OK: reload keeps persisted SL when candle history is incomplete");
