import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterPublicIndicatorStore,
  formatPublicBoosts,
  publicIndicatorScriptId,
} from "../../src/services/indicatorStoreModel";
import type { PublicIndicatorScript } from "../../src/services/api/resources/pineScriptsApi";

const rows: PublicIndicatorScript[] = [
  {
    id: "pub-vsa",
    scriptId: "pine-vsa",
    name: "VSA Volume",
    sourceCode: "indicator(\"VSA\")\nplot(volume)",
    authorId: "user-1",
    author: "TradeCalmly",
    boosts: 4100,
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:00:00Z",
  },
  {
    id: "pub-rsi",
    scriptId: "pine-rsi",
    name: "Better RSI",
    sourceCode: "indicator(\"Better RSI\")\nplot(close)",
    authorId: "user-2",
    author: "Skyline Trader",
    boosts: 12,
    createdAt: "2026-07-09T00:00:00Z",
    updatedAt: "2026-07-09T00:00:00Z",
  },
];

test("public indicator store filtering searches name, author, and source", () => {
  assert.deepEqual(
    filterPublicIndicatorStore(rows, "volume").map((row) => row.id),
    ["pub-vsa"],
  );
  assert.deepEqual(
    filterPublicIndicatorStore(rows, "skyline").map((row) => row.id),
    ["pub-rsi"],
  );
  assert.deepEqual(
    filterPublicIndicatorStore(rows, "plot(close)").map((row) => row.id),
    ["pub-rsi"],
  );
});

test("public indicator store formatting matches compact TradingView-style boosts", () => {
  assert.equal(formatPublicBoosts(0), "0");
  assert.equal(formatPublicBoosts(999), "999");
  assert.equal(formatPublicBoosts(1200), "1.2K");
  assert.equal(formatPublicBoosts(1_250_000), "1.3M");
});

test("public indicator store ids are scoped away from private pine ids", () => {
  assert.equal(publicIndicatorScriptId(rows[0]), "store:pub-vsa");
});
