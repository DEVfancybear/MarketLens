import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDrawingDataSnapshot, MAX_DRAWING_DATA_SAMPLES } from "../../src/components/chart/drawing/data/drawingDataSnapshot";

const candle = (time:number) => ({ time, open:time, high:time+2, low:time-2, close:time+1, volume:time });

test("between-anchor snapshot selects an inclusive immutable candle range",()=>{
  const candles=[candle(10),candle(20),candle(30),candle(40)];
  const result=buildDrawingDataSnapshot("between-anchors",[{time:35,price:1},{time:15,price:2}],candles," EURUSD ",123);
  assert.deepEqual(result?.samples.map(sample=>sample.time),[20,30]);
  assert.equal(result?.symbol,"EURUSD");assert.equal(result?.capturedAt,123);
  candles[1].close=999;assert.notEqual(result?.samples[0].close,999);
});

test("anchor-to-latest snapshot is capped at the newest 1000 samples",()=>{
  const candles=Array.from({length:MAX_DRAWING_DATA_SAMPLES+25},(_,index)=>candle(index));
  const result=buildDrawingDataSnapshot("anchor-to-latest",[{time:0,price:1}],candles,"BTCUSD");
  assert.equal(result?.samples.length,MAX_DRAWING_DATA_SAMPLES);
  assert.equal(result?.samples[0].time,25);
  assert.equal(result?.samples.at(-1)?.time,1024);
});

test("snapshot creation declines missing points, candles, and empty ranges",()=>{
  assert.equal(buildDrawingDataSnapshot("anchor-to-latest",[],[candle(1)],"X"),undefined);
  assert.equal(buildDrawingDataSnapshot("anchor-to-latest",[{time:1,price:1}],[],"X"),undefined);
  assert.equal(buildDrawingDataSnapshot("between-anchors",[{time:100,price:1},{time:200,price:1}],[candle(1)],"X"),undefined);
});

test("snapshot capture preserves immutable lower-timeframe and tick detail",()=>{
  const detailed = [{
    ...candle(10),
    subBars: [10,20,30,40,50,60].map((time) => ({ ...candle(time), volume: 3 })),
    ticks: [{ time: 10, price: 10.5, volume: 2, direction: "up" as const }],
    ticksComplete: true,
  }];
  const result=buildDrawingDataSnapshot(
    "anchor-to-latest",
    [{time:10,price:1}],
    detailed,
    "X",
  );
  assert.deepEqual(result?.samples[0].subBars,detailed[0].subBars);
  assert.deepEqual(result?.samples[0].ticks,detailed[0].ticks);
  assert.equal(result?.samples[0].subBarsComplete,true);
  assert.equal(result?.samples[0].ticksComplete,true);
  detailed[0].subBars[0].close=999;
  detailed[0].ticks[0].price=999;
  assert.notEqual(result?.samples[0].subBars?.[0].close,999);
  assert.notEqual(result?.samples[0].ticks?.[0].price,999);
});

test("snapshot marks lower-timeframe detail incomplete unless it covers every parent slot", () => {
  const chart = [candle(300), candle(600)];
  const partialFirstParent = [300, 360];
  const completeSecondParent = [600, 660, 720, 780, 840];
  const result = buildDrawingDataSnapshot(
    "between-anchors",
    [{ time: 300, price: 1 }, { time: 600, price: 1 }],
    chart,
    "X",
    900,
    {
      lowerTimeframeBars: [...partialFirstParent, ...completeSecondParent]
        .map((time) => ({ ...candle(time), volume: 1 })),
    },
  );

  assert.deepEqual(
    result?.samples.map((sample) => sample.subBarsComplete),
    [false, false],
  );
});

test("snapshot capture reconstructs cached lower-timeframe bars and recent ticks", () => {
  const chart = [candle(300), candle(600)];
  const lower = [300, 360, 420, 480, 540, 600, 660, 720, 780, 840]
    .map((time) => ({ ...candle(time), volume: 1 }));
  const ticks = [
    { time: 310, price: 301, direction: "up" as const },
    { time: 610, price: 599, direction: "down" as const },
  ];
  const result = buildDrawingDataSnapshot(
    "between-anchors",
    [{ time: 300, price: 1 }, { time: 600, price: 1 }],
    chart,
    "X",
    900,
    {
      lowerTimeframeBars: lower,
      ticks,
      tickCoverage: { start: 300, end: 900 },
    },
  );
  assert.deepEqual(result?.samples.map((sample) => sample.subBars?.length), [5, 5]);
  assert.deepEqual(result?.samples.map((sample) => sample.ticks?.length), [1, 1]);
  assert.ok(result?.samples.every((sample) => sample.subBarsComplete && sample.ticksComplete));
});

test("recent ticks remain incomplete without retained-ring coverage evidence", () => {
  const chart = [candle(300), candle(600)];
  const ticks = [
    { time: 310, price: 301, volume: 2 },
    { time: 610, price: 599, volume: 3 },
  ];
  const missingStart = buildDrawingDataSnapshot(
    "between-anchors",
    [{ time: 300, price: 1 }, { time: 600, price: 1 }],
    chart,
    "X",
    900,
    { ticks, tickCoverage: { start: 310, end: 900 } },
  );
  assert.ok(missingStart?.samples.every((sample) => sample.ticksComplete === false));

  const missingEnd = buildDrawingDataSnapshot(
    "between-anchors",
    [{ time: 300, price: 1 }, { time: 600, price: 1 }],
    chart,
    "X",
    900,
    { ticks, tickCoverage: { start: 300, end: 899 } },
  );
  assert.ok(missingEnd?.samples.every((sample) => sample.ticksComplete === false));
});
