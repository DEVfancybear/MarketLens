import assert from "node:assert/strict";
import test from "node:test";
import {
  moveSymbolInList,
  moveSymbolToSectionInList,
  removeSectionFromList,
  removeSymbolFromList,
  renameSectionInList,
  resolveSectionDropMode,
} from "../../src/store/watchlistLayout";
import type { WatchlistList } from "../../src/store/watchlistStore";

function list(): WatchlistList {
  return {
    id: "wl_1",
    name: "Watchlist",
    shared: false,
    symbols: ["BTCUSDT", "GBPUSD", "USDCAD", "XAUUSD"],
    sections: [{ id: "section_1", title: "SECTION 1", index: 1 }],
  };
}

function twoSectionList(): WatchlistList {
  return {
    id: "wl_2",
    name: "Watchlist",
    shared: false,
    symbols: ["DOGEUSDT", "ETHUSDT"],
    sections: [
      { id: "section_1", title: "SECTION 1", index: 1 },
      { id: "section_2", title: "SECTION 2", index: 1 },
    ],
  };
}

function trailingEmptySectionList(): WatchlistList {
  return {
    id: "wl_3",
    name: "Watchlist",
    shared: false,
    symbols: ["DOGEUSDT", "ETHUSDT"],
    sections: [
      { id: "section_1", title: "SECTION 1", index: 0 },
      { id: "section_2", title: "SECTION 2", index: 2 },
    ],
  };
}

test("renames a section without changing symbols", () => {
  const result = renameSectionInList(list(), "section_1", "Majors");

  assert.equal(result.sections[0].title, "Majors");
  assert.deepEqual(result.symbols, ["BTCUSDT", "GBPUSD", "USDCAD", "XAUUSD"]);
});

test("removes only the section header", () => {
  const result = removeSectionFromList(list(), "section_1");

  assert.deepEqual(result.sections, []);
  assert.deepEqual(result.symbols, ["BTCUSDT", "GBPUSD", "USDCAD", "XAUUSD"]);
});

test("drops a symbol inside a section while keeping the section before it", () => {
  const result = moveSymbolInList(list(), "BTCUSDT", 1, "inside-section");

  assert.deepEqual(result.symbols, ["BTCUSDT", "GBPUSD", "USDCAD", "XAUUSD"]);
  assert.equal(result.sections[0].index, 0);
});

test("drops a symbol before a section and shifts the section header", () => {
  const result = moveSymbolInList(list(), "XAUUSD", 1, "before-section");

  assert.deepEqual(result.symbols, ["BTCUSDT", "XAUUSD", "GBPUSD", "USDCAD"]);
  assert.equal(result.sections[0].index, 2);
});

test("removing a symbol before a section shifts the section left", () => {
  const result = removeSymbolFromList(list(), "BTCUSDT");

  assert.deepEqual(result.symbols, ["GBPUSD", "USDCAD", "XAUUSD"]);
  assert.equal(result.sections[0].index, 0);
});

test("drops a symbol into the first of multiple sections sharing an index", () => {
  const result = moveSymbolToSectionInList(
    twoSectionList(),
    "DOGEUSDT",
    "section_1",
    "inside-section",
  );

  assert.deepEqual(result.symbols, ["DOGEUSDT", "ETHUSDT"]);
  assert.deepEqual(
    result.sections.map((section) => [section.id, section.index]),
    [
      ["section_1", 0],
      ["section_2", 1],
    ],
  );
});

test("drops a symbol into the second of multiple sections sharing an index", () => {
  const result = moveSymbolToSectionInList(
    twoSectionList(),
    "DOGEUSDT",
    "section_2",
    "inside-section",
  );

  assert.deepEqual(result.symbols, ["DOGEUSDT", "ETHUSDT"]);
  assert.deepEqual(
    result.sections.map((section) => [section.id, section.index]),
    [
      ["section_1", 0],
      ["section_2", 0],
    ],
  );
});

test("drops a symbol into a trailing empty section", () => {
  const result = moveSymbolToSectionInList(
    trailingEmptySectionList(),
    "ETHUSDT",
    "section_2",
    "inside-section",
  );

  assert.deepEqual(result.symbols, ["DOGEUSDT", "ETHUSDT"]);
  assert.deepEqual(
    result.sections.map((section) => [section.id, section.index]),
    [
      ["section_1", 0],
      ["section_2", 1],
    ],
  );
});

test("section rows treat most of the row as an inside-section drop", () => {
  assert.equal(resolveSectionDropMode(101, 100, 20), "before-section");
  assert.equal(resolveSectionDropMode(106, 100, 20), "inside-section");
  assert.equal(resolveSectionDropMode(119, 100, 20), "inside-section");
});
