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
