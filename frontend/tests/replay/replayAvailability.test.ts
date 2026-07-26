import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../../src/services/api/errors";
import {
  recoverableReplayTrack,
  replayUnavailableTrack,
} from "../../src/services/replay/replayAvailability";
import type { CreateReplaySessionInput } from "../../src/services/api/resources/replayApi";

function input(requiredSlot: number): CreateReplaySessionInput {
  return {
    mode: "all_charts",
    start: { kind: "time", time: "2026-07-24T07:45:00.000Z" },
    tracks: [
      { slot: 0, symbol: "ADAUSD", chartTimeframe: "15m", required: requiredSlot === 0 },
      { slot: 1, symbol: "XRPUSD", chartTimeframe: "15m", required: requiredSlot === 1 },
      { slot: 2, symbol: "USDINR", chartTimeframe: "15m", required: requiredSlot === 2 },
      { slot: 3, symbol: "USDCHF", chartTimeframe: "15m", required: requiredSlot === 3 },
    ],
  };
}

function unavailable(slot: number, symbol: string) {
  return new ApiError(422, "data_point_unavailable", "Unavailable", {
    slot,
    symbol,
    chartTimeframe: "15m",
    firstAvailableTime: "2024-08-05T02:11:00.000Z",
    lastAvailableTime: "2024-08-08T13:39:00.000Z",
  });
}

test("multi-chart availability details preserve exact pane identity", () => {
  assert.deepEqual(replayUnavailableTrack(unavailable(0, "ADAUSD")), {
    slot: 0,
    symbol: "ADAUSD",
    chartTimeframe: "15m",
    firstAvailableTime: "2024-08-05T02:11:00.000Z",
    lastAvailableTime: "2024-08-08T13:39:00.000Z",
  });
});

test("an unavailable sibling is recoverable but the active pane is never removed", () => {
  assert.equal(recoverableReplayTrack(unavailable(0, "ADAUSD"), input(2))?.symbol, "ADAUSD");
  assert.equal(recoverableReplayTrack(unavailable(2, "USDINR"), input(2)), null);
});

test("single-chart Replay never isolates its only track", () => {
  const request = input(0);
  request.mode = "single_chart";
  request.tracks = [request.tracks[0]];
  assert.equal(recoverableReplayTrack(unavailable(0, "ADAUSD"), request), null);
});
