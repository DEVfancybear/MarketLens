import assert from "node:assert/strict";
import test from "node:test";
import type {
  ReplayEventEnvelope,
  ReplaySessionSnapshot,
} from "../../src/services/api/resources/replayApi";
import { ReplayClientStore } from "../../src/store/replayClientStore";

function snapshot(): ReplaySessionSnapshot {
  return {
    id: "session-1",
    status: "paused",
    mode: "single_chart",
    generation: 1,
    version: 1,
    lastEventSeq: 0,
    speed: 1,
    replayIntervalSeconds: 60,
    startTime: "2026-05-01T10:00:00Z",
    simulatedTime: "2026-05-01T10:00:00Z",
    pauseReason: "created",
    tracks: [{
      id: "track-1",
      slot: 0,
      symbol: "EURUSD",
      provider: "mt5",
      marketCalendar: "mt5:EURUSD:UTC",
      chartTimeframe: "1m",
      cursorSeq: 10,
      visibleThrough: "2026-05-01T10:00:00Z",
      dataset: {
        id: "dataset-1",
        dataKind: "bars",
        sourceTimeframe: "1m",
        baseIntervalSeconds: 60,
        firstAvailableTime: "2026-05-01T09:00:00Z",
        lastAvailableTime: "2026-05-01T11:00:00Z",
        snapshotAt: "2026-05-01T11:00:00Z",
        rowCount: 121,
        checksumSha256: "a".repeat(64),
        status: "ready",
      },
    }],
    createdAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-01T10:00:00Z",
  };
}

function event(seq: number): ReplayEventEnvelope {
  return {
    sessionId: "session-1",
    eventSeq: seq,
    version: seq + 1,
    simulatedTime: `2026-05-01T10:0${seq}:00Z`,
    type: "cursor.advanced",
    payload: {
      trackId: "track-1",
      cursorSeq: 10 + seq,
      visibleThrough: `2026-05-01T10:0${seq}:00Z`,
    },
  };
}

test("replay client applies only the exact next event", () => {
  const store = new ReplayClientStore();
  store.replaceSnapshot(snapshot());
  assert.equal(store.applyEvent(event(1)), "applied");
  assert.equal(store.getState().snapshot?.tracks[0].cursorSeq, 11);
  assert.equal(store.applyEvent(event(1)), "duplicate");
  assert.equal(store.applyEvent(event(3)), "gap");
  assert.equal(store.getState().snapshot?.lastEventSeq, 1);
});

test("reconnect snapshot replaces stale projection", () => {
  const store = new ReplayClientStore();
  store.replaceSnapshot(snapshot());
  store.applyEvent(event(1));
  const recovered = snapshot();
  recovered.version = 8;
  recovered.lastEventSeq = 7;
  recovered.tracks[0].cursorSeq = 17;
  store.replaceSnapshot(recovered);
  assert.equal(store.getState().snapshot?.version, 8);
  assert.equal(store.getState().snapshot?.tracks[0].cursorSeq, 17);
});

test("an older command response cannot regress an event-updated projection", () => {
  const store = new ReplayClientStore();
  store.replaceSnapshot(snapshot());
  store.applyEvent(event(1));
  const stale = snapshot();
  stale.version = 1;
  stale.lastEventSeq = 0;
  store.replaceSnapshot(stale);
  assert.equal(store.getState().snapshot?.lastEventSeq, 1);
  assert.equal(store.getState().snapshot?.tracks[0].cursorSeq, 11);
});

test("optimistic controls survive stale server state until acknowledged", () => {
  const store = new ReplayClientStore();
  const initial = snapshot();
  initial.status = "playing";
  store.replaceSnapshot(initial);
  store.setOptimisticControls({ status: "paused", speed: 3 });

  const stale = snapshot();
  stale.status = "playing";
  stale.speed = 1;
  store.replaceSnapshot(stale);
  assert.equal(store.getState().snapshot?.status, "paused");
  assert.equal(store.getState().snapshot?.speed, 3);

  const acknowledged = snapshot();
  acknowledged.version = 2;
  acknowledged.status = "paused";
  acknowledged.speed = 3;
  store.replaceSnapshot(acknowledged);
  assert.equal(store.getState().snapshot?.status, "paused");
  assert.equal(store.getState().snapshot?.speed, 3);
});

test("progressive bar upserts replace only the revealed aggregate", () => {
  const store = new ReplayClientStore();
  store.replaceSnapshot(snapshot());
  store.replaceBars("session-1", "track-1", [{
    time: "2026-05-01T10:00:00Z", open: 1, high: 2, low: 1, close: 1.5, volume: 10, complete: false,
  }]);
  const revealedBar = { time: "2026-05-01T10:00:00Z", open: 1, high: 3, low: .5, close: 2, volume: 12, complete: false };
  const upsert: ReplayEventEnvelope = {
    sessionId: "session-1",
    eventSeq: 1,
    version: 2,
    simulatedTime: "2026-05-01T10:01:00Z",
    type: "track.bar.upsert",
    payload: {
      trackId: "track-1",
      bar: revealedBar,
    },
  };
  assert.equal(store.applyEvent(upsert), "applied");
  assert.deepEqual(store.getState().barsByTrack["track-1"], [revealedBar]);
});

test("track reset clears revealed bars until HTTP hydration", () => {
  const store = new ReplayClientStore();
  store.replaceSnapshot(snapshot());
  store.replaceBars("session-1", "track-1", [{
    time: "2026-05-01T10:00:00Z", open: 1, high: 2, low: 1, close: 1.5, volume: 10, complete: true,
  }]);
  assert.equal(store.applyEvent({
    sessionId: "session-1", eventSeq: 1, version: 2,
    simulatedTime: "2026-05-01T09:30:00Z", type: "track.reset", payload: { trackId: "track-1" },
  }), "applied");
  assert.deepEqual(store.getState().barsByTrack["track-1"], []);
});

test("high-speed bar batches are applied as one ordered projection event", () => {
  const store = new ReplayClientStore();
  store.replaceSnapshot(snapshot());
  const bars = [
    { time: "2026-05-01T10:01:00Z", open: 1, high: 2, low: 1, close: 1.5, volume: 10, complete: true },
    { time: "2026-05-01T10:02:00Z", open: 1.5, high: 3, low: 1.4, close: 2, volume: 12, complete: true },
  ];
  assert.equal(store.applyEvent({
    sessionId: "session-1", eventSeq: 1, version: 2,
    simulatedTime: "2026-05-01T10:02:00Z", type: "track.bars.batch",
    payload: { trackId: "track-1", bars },
  }), "applied");
  assert.deepEqual(store.getState().barsByTrack["track-1"], bars);
});

test("authoritative snapshots replace the isolated replay trading ledger", () => {
  const store = new ReplayClientStore();
  const initial = snapshot();
  initial.trading = {
    account: { baseCurrency: "USD", startingEquity: 10_000, balance: 10_000, equity: 10_000 },
    orders: [], fills: [], positions: [],
  };
  store.replaceSnapshot(initial);

  const filled = snapshot();
  filled.version = 2;
  filled.lastEventSeq = 4;
  filled.trading = {
    account: { baseCurrency: "USD", startingEquity: 10_000, balance: 10_025, equity: 10_025 },
    orders: [{
      id: "order-1", trackId: "track-1", clientOrderId: "client-1", side: "buy",
      orderType: "market", status: "filled", quantity: 1, filledQuantity: 1,
      submittedAt: "2026-05-01T10:01:00Z",
    }],
    fills: [{
      id: "fill-1", orderId: "order-1", trackId: "track-1", datasetSeq: 11,
      simulatedAt: "2026-05-01T10:01:00Z", price: 1.1, quantity: 1, commission: 0,
    }],
    positions: [],
  };
  store.replaceSnapshot(filled);

  assert.equal(store.getState().snapshot?.trading?.account.balance, 10_025);
  assert.equal(store.getState().snapshot?.trading?.fills[0].datasetSeq, 11);
  assert.equal(store.getState().snapshot?.trading?.orders[0].status, "filled");
});

test("unavailable layout tracks survive snapshot activation and clear on exit", () => {
  const store = new ReplayClientStore();
  store.setUnavailableTracks([{
    slot: 0,
    symbol: "ADAUSD",
    chartTimeframe: "15m",
    firstAvailableTime: "2024-08-05T02:11:00.000Z",
    lastAvailableTime: "2024-08-08T13:39:00.000Z",
  }]);
  store.replaceSnapshot(snapshot());
  assert.equal(store.getState().unavailableTracks[0]?.symbol, "ADAUSD");

  store.clear();
  assert.deepEqual(store.getState().unavailableTracks, []);
});
