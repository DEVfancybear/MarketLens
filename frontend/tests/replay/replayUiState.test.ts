import assert from "node:assert/strict";
import test from "node:test";

import {
  replayAutoIntervalSeconds,
  replayControlMessage,
  replaySessionInputAt,
} from "../../src/store/replayUiState";

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

test("Replay Auto interval matches TradingView single and synchronized layouts", () => {
  const track = (chartTimeframe: string, baseIntervalSeconds = 60) => ({
    chartTimeframe,
    dataset: { baseIntervalSeconds },
  });
  assert.equal(replayAutoIntervalSeconds([track("15m")]), 900);
  assert.equal(replayAutoIntervalSeconds([track("15m"), track("1H")]), 900);
  assert.equal(replayAutoIntervalSeconds([track("1W", 86400)]), 86400);
  assert.equal(replayAutoIntervalSeconds([track("1M", 86400)]), 86400);
});
