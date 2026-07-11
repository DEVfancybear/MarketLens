import assert from "node:assert/strict";
import { test } from "node:test";
import type { Position } from "../../src/types";
import type { BackendSimPosition } from "../../src/services/api/resources/simTradingApi";

process.env.NEXT_PUBLIC_API_BASE_URL = "http://backend.test";

test("sim trading adapters preserve client ids and convert epoch seconds", async () => {
  const api = await import("../../src/services/api/resources/simTradingApi");
  const local: Position = {
    id: "pos-local-1", symbol: "EURUSD", side: "long", type: "market", status: "closed",
    entry: 1.1, quantity: 2, remaining: 0, riskAmount: 100, realizedPnl: 20,
    unrealizedPnl: 0, openTime: 1_700_000_000, closeTime: 1_700_000_060,
    fills: [{ time: 1_700_000_000, price: 1.1, quantity: 2, kind: "open" }],
  };
  const write = api.positionToWrite(local);
  assert.equal(write.clientId, local.id);
  assert.equal(write.openTime, "2023-11-14T22:13:20.000Z");

  const backend: BackendSimPosition = {
    ...write, id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2023-11-14T22:13:20Z", updatedAt: "2023-11-14T22:14:20Z",
  };
  assert.deepEqual(api.positionFromBackend(backend), local);
});
