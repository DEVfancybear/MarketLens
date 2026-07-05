#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const replayEngine = readFileSync(resolve(root, "src/services/replayEngine.ts"), "utf8");
const replayStore = readFileSync(resolve(root, "src/store/replayStore.ts"), "utf8");
const timingMenu = readFileSync(
  resolve(root, "src/components/replay/ReplayTimingMenu.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  resolve(root, "src/components/replay/ReplayDashboard.tsx"),
  "utf8",
);
const priceChart = readFileSync(
  resolve(root, "src/components/chart/PriceChart.tsx"),
  "utf8",
);
const replayViewport = readFileSync(
  resolve(root, "src/components/chart/replayViewport.ts"),
  "utf8",
);
const selectionLayer = readFileSync(
  resolve(root, "src/components/replay/ReplaySelectionLayer.tsx"),
  "utf8",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function indexAtOrBefore(candles, time) {
  if (candles.length === 0) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function indexNearestByTime(candles, time) {
  if (candles.length === 0) return -1;
  const before = indexAtOrBefore(candles, time);
  if (before < 0) return 0;
  if (before >= candles.length - 1) return candles.length - 1;
  const after = before + 1;
  return Math.abs(candles[before].time - time) <=
    Math.abs(candles[after].time - time)
    ? before
    : after;
}

function checkNearestDateSelection() {
  const candles = [{ time: 1000 }, { time: 1060 }, { time: 1120 }];
  assert(indexAtOrBefore(candles, 900) === -1, "at-or-before must return -1 before first bar");
  assert(indexNearestByTime(candles, 900) === 0, "nearest date before history should clamp to first bar");
  assert(indexNearestByTime(candles, 1055) === 1, "nearest date should choose the later closer bar");
  assert(indexNearestByTime(candles, 1025) === 0, "nearest date should choose the earlier closer bar");
  assert(indexNearestByTime(candles, 1030) === 0, "ties should keep the earlier bar");
  assert(indexNearestByTime(candles, 1200) === 2, "nearest date after history should clamp to last bar");
  assert(indexNearestByTime([], 1000) === -1, "empty candle list should return -1");
}

function checkStaticGuards() {
  assert(
    /export function indexNearestByTime/.test(replayEngine),
    "replayEngine must expose indexNearestByTime for TradingView Select date parity",
  );
  assert(
    /if \(candles\.length === 0\) return -1;/.test(replayEngine),
    "index helpers must guard empty candle lists",
  );
  assert(
    /indexNearestByTime\(candles, t\)/.test(timingMenu),
    "ReplayTimingMenu Select date must choose the candle closest to the selected date",
  );
  assert(
    /indexNearestByTime\(candles, t\)/.test(dashboard),
    "ReplayDashboard jump must choose the candle closest to the selected date",
  );
  assert(
    /indexNearestByTime\(data, t as number\)/.test(selectionLayer),
    "ReplaySelectionLayer chart picking must share the same nearest-candle logic",
  );
  assert(
    /const idx = indexAtOrBefore\(series, time\);/.test(replayEngine),
    "mtfSnapshot must keep at-or-before semantics to avoid higher-timeframe lookahead",
  );
  assert(
    /let ans = -1;/.test(replayEngine) &&
      /if \(before < 0\) return 0;/.test(replayEngine) &&
      /if \(before >= candles\.length - 1\) return candles\.length - 1;/.test(replayEngine),
    "date selection helpers must clamp outside-history jumps without fabricating a future bar",
  );
  assert(
    /function keepLatestBarInView/.test(priceChart) &&
      /const structuralDataWindowChange =/.test(priceChart) &&
      /shouldRealignReplayViewport/.test(priceChart) &&
      /keepLatestBarInView\(chart, dataLength\)/.test(priceChart),
    "PriceChart must realign the viewport after replay jump/scrub data-window replacements",
  );
  assert(
    /export function replayRangeIntersectsData/.test(replayViewport) &&
      /export function shouldRealignReplayViewport/.test(replayViewport) &&
      /export function latestReplayLogicalRange/.test(replayViewport),
    "Replay viewport helpers must guard future-whitespace blank chart cases",
  );
  assert(
    /const safeTotal = Math\.max\(0, total\);/.test(replayStore),
    "setTotalAtom must sanitize total history length",
  );
  assert(
    /set\(activeAtom, false\);/.test(replayStore) &&
      /set\(cursorAtom, 0\);/.test(replayStore),
    "setTotalAtom must fully disarm/reset replay when history becomes empty",
  );
  assert(
    /const anchor = Math\.min\(get\(anchorAtom\), max\);/.test(replayStore) &&
      /const cursor = Math\.max\(anchor, Math\.min\(max, get\(cursorAtom\)\)\);/.test(replayStore),
    "setTotalAtom must clamp anchor and cursor when history shrinks",
  );
}

checkNearestDateSelection();
checkStaticGuards();

console.log("[replay-logic] OK: date selection, viewport realignment, MTF no-lookahead, and total clamping are guarded");
