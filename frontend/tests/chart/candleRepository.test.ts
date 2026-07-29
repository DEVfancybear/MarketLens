import assert from "node:assert/strict";
import test from "node:test";
import type { MarketCandle } from "../../src/types";
import {
  mergeHistoryWithLiveCandles,
  resolveRealtimeSeriesUpdatePlan,
} from "../../src/services/market-data/candleSeries";
import {
  candleAtRepositoryIndex,
  createCandleRepository,
  evictCandleRepositories,
  findCandleIndexByTime,
  materializeCandleRepository,
  mergeHistoryIntoCandleRepository,
  upsertCandleRepository,
} from "../../src/services/market-data/candleRepository";

function candles(count: number, startTime = 1_700_000_000): MarketCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index / 10;
    return {
      time: startTime + index * 60,
      open: close - 0.1,
      high: close + 0.4,
      low: close - 0.5,
      close,
      volume: 100 + index,
      closed: true,
    };
  });
}

test("chunk repository materializes a sorted flat compatibility view", () => {
  const input = candles(600);
  const repository = createCandleRepository(input);
  assert.equal(repository.length, 600);
  assert.deepEqual(repository.chunks.map((chunk) => chunk.length), [256, 256, 88]);
  assert.deepEqual(materializeCandleRepository(repository), input);
  assert.equal(materializeCandleRepository(repository), materializeCandleRepository(repository));
  assert.ok(repository.chunks.every(Object.isFrozen));
});

test("binary timestamp and global-index lookups cross chunk boundaries", () => {
  const input = candles(600);
  const repository = createCandleRepository(input);
  for (const index of [0, 255, 256, 511, 512, 599]) {
    assert.equal(findCandleIndexByTime(repository, input[index].time), index);
    assert.equal(candleAtRepositoryIndex(repository, index)?.time, input[index].time);
  }
  assert.equal(findCandleIndexByTime(repository, input[10].time + 1), -1);
  assert.equal(candleAtRepositoryIndex(repository, 600), undefined);
});

test("latest and delayed corrections clone only their affected chunk", () => {
  const input = candles(600);
  const repository = createCandleRepository(input);
  const latest = upsertCandleRepository(repository, {
    ...input[599],
    close: input[599].close + 2,
  });
  assert.equal(latest.chunks[0], repository.chunks[0]);
  assert.equal(latest.chunks[1], repository.chunks[1]);
  assert.notEqual(latest.chunks[2], repository.chunks[2]);

  const corrected = upsertCandleRepository(latest, {
    ...input[300],
    high: input[300].high + 3,
  });
  assert.equal(corrected.chunks[0], latest.chunks[0]);
  assert.notEqual(corrected.chunks[1], latest.chunks[1]);
  assert.equal(corrected.chunks[2], latest.chunks[2]);
  assert.equal(materializeCandleRepository(corrected)[300].high, input[300].high + 3);
});

test("history prepend preserves existing chunk identities and flat parity", () => {
  const live = candles(600, 1_700_100_000);
  const older = candles(300, live[0].time - 300 * 60);
  const repository = createCandleRepository(live);
  const merged = mergeHistoryIntoCandleRepository(repository, older, 5_000);
  const flat = materializeCandleRepository(merged);
  assert.deepEqual(flat, mergeHistoryWithLiveCandles(older, live, 5_000));
  for (const chunk of repository.chunks) {
    assert.ok(merged.chunks.includes(chunk));
  }
});

test("overlapping history keeps live forming tail and matches legacy semantics", () => {
  const live = candles(600);
  live[599] = { ...live[599], close: 999, closed: false };
  const refresh = candles(20, live[580].time).map((candle) => ({
    ...candle,
    close: candle.close + 10,
  }));
  const repository = createCandleRepository(live);
  const merged = mergeHistoryIntoCandleRepository(repository, refresh, 5_000);
  assert.deepEqual(
    materializeCandleRepository(merged),
    mergeHistoryWithLiveCandles(refresh, live, 5_000),
  );
  assert.equal(materializeCandleRepository(merged).at(-1)?.close, 999);
  assert.equal(merged.chunks[0], repository.chunks[0]);
});

test("value-equal history tail preserves the existing repository and candle references", () => {
  const repository = createCandleRepository(candles(600));
  const current = materializeCandleRepository(repository);
  const refresh = current.slice(-20).map((candle) => ({ ...candle }));

  const merged = mergeHistoryIntoCandleRepository(repository, refresh, 5_000);
  const next = materializeCandleRepository(merged);

  assert.equal(merged, repository);
  assert.equal(next, current);
  for (let index = current.length - refresh.length; index < current.length; index += 1) {
    assert.equal(next[index], current[index]);
  }
});

test("single forming-bar change after a history refresh keeps the realtime update path", () => {
  const repository = createCandleRepository(candles(600));
  const current = materializeCandleRepository(repository);
  const refresh = current.slice(-20).map((candle) => ({ ...candle }));
  refresh[refresh.length - 1] = {
    ...refresh[refresh.length - 1],
    close: refresh[refresh.length - 1].close + 0.05,
  };

  const next = materializeCandleRepository(
    mergeHistoryIntoCandleRepository(repository, refresh, 5_000),
  );

  for (let index = 0; index < current.length - 1; index += 1) {
    assert.equal(next[index], current[index]);
  }
  assert.notEqual(next.at(-1), current.at(-1));
  assert.equal(resolveRealtimeSeriesUpdatePlan(current, next, true), "update-latest");
});

test("max-candle trim drops old chunks while retaining the newest range", () => {
  const input = candles(600);
  const repository = createCandleRepository(input, 500);
  assert.equal(repository.length, 500);
  assert.equal(materializeCandleRepository(repository)[0].time, input[100].time);
  const appended = upsertCandleRepository(repository, candles(1, input[599].time + 60)[0], 500);
  assert.equal(appended.length, 500);
  assert.equal(materializeCandleRepository(appended)[0].time, input[101].time);
});

test("inactive repository budget evicts least-recently-used entries", () => {
  const repositories = {
    old: createCandleRepository(candles(100), undefined, 1),
    middle: createCandleRepository(candles(100, 1_800_000_000), undefined, 2),
    active: createCandleRepository(candles(100, 1_900_000_000), undefined, 3),
  };
  const next = evictCandleRepositories(repositories, new Set(["active"]), {
    maxRepositories: 2,
    maxCandles: 250,
  });
  assert.deepEqual(Object.keys(next).sort(), ["active", "middle"]);
});
