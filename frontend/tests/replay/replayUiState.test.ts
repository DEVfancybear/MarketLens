import assert from "node:assert/strict";
import test from "node:test";

import {
  replayControlMessage,
  replaySessionInputAt,
} from "../../src/components/replay/replayUiState";

test("Replay controls expose kill-switch, auth, loading, and server error states", () => {
  assert.match(replayControlMessage({ enabled: false, authenticated: true, connection: "idle", error: null }) ?? "", /disabled/);
  assert.match(replayControlMessage({ enabled: true, authenticated: false, connection: "idle", error: null }) ?? "", /Sign in/);
  assert.match(replayControlMessage({ enabled: true, authenticated: true, connection: "connecting", error: null }) ?? "", /Preparing/);
  assert.equal(replayControlMessage({ enabled: true, authenticated: true, connection: "error", error: "backend failed" }), "backend failed");
});

test("selection sends the requested UTC time and lets the backend validate it", () => {
  const input = replaySessionInputAt(
    1_700_000_000,
    { symbol: "EURUSD", chartTimeframe: "15m" },
    "single_chart",
    "single",
  );
  assert.equal(input.start.time, new Date(1_700_000_000 * 1000).toISOString());
  assert.deepEqual(input.tracks, [{ slot: 0, symbol: "EURUSD", chartTimeframe: "15m" }]);
});
