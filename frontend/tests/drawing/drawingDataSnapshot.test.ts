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
