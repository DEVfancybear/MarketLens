import assert from "node:assert/strict";
import test from "node:test";
import {
  moveDisplayedSymbolRelativeInList,
  moveSectionInList,
} from "../../src/store/watchlistLayout";
import { createRemoteWatchlistLayoutPayload } from "../../src/store/watchlistPersistence";
import type { WatchlistList } from "../../src/store/watchlistStore";

function sortedSectionList(): WatchlistList {
  return {
    id: "server-watchlist-1",
    name: "Majors",
    shared: false,
    sortKey: "price",
    sortDir: "asc",
    symbols: ["BTCUSD", "EURUSD", "GBPUSD", "USDCHF"],
    sections: [{ id: "forex", title: "FOREX", index: 1 }],
  };
}

test("full same-section drag pipeline persists the visible custom order", () => {
  const current = sortedSectionList();
  const displayedOrder = ["BTCUSD", "USDCHF", "EURUSD", "GBPUSD"];

  const moved = moveDisplayedSymbolRelativeInList(
    current,
    "USDCHF",
    "GBPUSD",
    "after",
    displayedOrder,
  );
  const manual: WatchlistList = {
    ...moved,
    sortKey: "manual",
    sortDir: "asc",
  };
  const payload = createRemoteWatchlistLayoutPayload(manual);

  assert.deepEqual(manual.symbols, ["BTCUSD", "EURUSD", "GBPUSD", "USDCHF"]);
  assert.deepEqual(manual.sections, [{ id: "forex", title: "FOREX", index: 1 }]);
  assert.deepEqual(payload, {
    symbols: ["BTCUSD", "EURUSD", "GBPUSD", "USDCHF"],
    sections: [{ title: "FOREX", index: 1 }],
    sortKey: "manual",
    sortDir: "asc",
  });
});

test("full section drag pipeline persists section position and canonical symbols", () => {
  const current = sortedSectionList();
  const displayedOrder = ["BTCUSD", "USDCHF", "EURUSD", "GBPUSD"];
  const materialized: WatchlistList = {
    ...current,
    symbols: displayedOrder,
  };
  const moved = moveSectionInList(materialized, "forex", {
    kind: "symbol-boundary",
    index: 3,
  });
  const manual: WatchlistList = {
    ...moved,
    sortKey: "manual",
    sortDir: "asc",
  };

  assert.deepEqual(createRemoteWatchlistLayoutPayload(manual), {
    symbols: ["BTCUSD", "USDCHF", "EURUSD", "GBPUSD"],
    sections: [{ title: "FOREX", index: 3 }],
    sortKey: "manual",
    sortDir: "asc",
  });
});
