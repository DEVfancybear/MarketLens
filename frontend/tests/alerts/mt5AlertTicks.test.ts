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

test("MT5 alert ticks accept the legacy crypto alias in either direction", () => {
  const requestedLegacy = normalizeMt5AlertTicks(
    [
      {
        symbol: "BTCUSD",
        bid: 64_000,
        ask: 64_001,
        timestamp: 1_700_000_002,
      },
    ],
    "BTCUSDT",
  );
  const requestedCanonical = normalizeMt5AlertTicks(
    [
      {
        symbol: "BTCUSDT",
        bid: 64_000,
        ask: 64_001,
        timestamp: 1_700_000_002,
      },
    ],
    "BTCUSD",
  );
  assert.equal(requestedLegacy.length, 1);
  assert.equal(requestedCanonical.length, 1);
});

test("MT5 alert ticks accept broker suffixes and catalog metal aliases", () => {
  const suffix = normalizeMt5AlertTicks(
    [
      {
        symbol: "BTCUSD.r",
        bid: 64_000,
        timestamp: 1_700_000_002,
      },
    ],
    "BTCUSDT",
  );
  const metal = normalizeMt5AlertTicks(
    [
      {
        symbol: "GOLD",
        bid: 2_400,
        timestamp: 1_700_000_002,
      },
    ],
    "XAUUSD",
  );
  assert.equal(suffix.length, 1);
  assert.equal(metal.length, 1);
});
