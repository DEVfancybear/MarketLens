import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeMt5AlertTicks } from "../../src/services/market-data/mt5AlertTicks";

test("MT5 dynamic alerts evaluate broker time but replay in receive order", () => {
  const ticks = normalizeMt5AlertTicks(
    [
      {
        symbol: "EURUSD",
        bid: 1.2,
        ask: 1.2002,
        time_msc: 1_700_000_020_000,
        received_at: 1_700_000_001_000,
      },
      {
        symbol: "EURUSD",
        bid: 1.1,
        ask: 1.1002,
        time_msc: 1_700_000_010_000,
        received_at: 1_700_000_002_000,
      },
    ],
    "eurusd",
  );

  assert.deepEqual(
    ticks.map(({ timestamp, receivedAt }) => ({ timestamp, receivedAt })),
    [
      { timestamp: 1_700_000_020_000, receivedAt: 1_700_000_001_000 },
      { timestamp: 1_700_000_010_000, receivedAt: 1_700_000_002_000 },
    ],
    "broker time may move backward without changing the retained receive order",
  );
  assert.deepEqual(ticks.map((tick) => tick.price), [1.2, 1.1]);
});

test("MT5 alert tick normalization falls back to chart timestamp and rejects noise", () => {
  const ticks = normalizeMt5AlertTicks(
    [
      { symbol: "GBPUSD", bid: 1, ask: 1.1, timestamp: 1_700_000_000 },
      { symbol: "EURUSD", bid: Number.NaN, timestamp: 1_700_000_001 },
      { symbol: "EURUSD", bid: 1.2, timestamp: 0 },
      { symbol: "EURUSD", bid: 1.3, timestamp: 1_700_000_002 },
    ],
    "EURUSD",
  );
  assert.deepEqual(ticks, [
    {
      price: 1.3,
      timestamp: 1_700_000_002_000,
      receivedAt: 1_700_000_002_000,
    },
  ]);
});
