import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_EMOJI_SELECTION,
  EMOJI_CATALOG_SECTIONS,
  getEmojiCatalogItem,
  ICON_CATALOG,
  MAX_EMOJI_RECENTS,
  normalizeEmojiRecents,
  pushEmojiRecent,
  STICKER_CATALOG,
} from "../../src/types/emojiCatalog";

test("icons picker exposes the TradingView-style catalog surfaces", () => {
  assert.deepEqual(
    EMOJI_CATALOG_SECTIONS.map((section) => section.id),
    [
      "smileys",
      "animals",
      "food",
      "activities",
      "travel",
      "objects",
      "symbols",
      "flags",
    ],
  );
  assert.ok(
    EMOJI_CATALOG_SECTIONS.reduce(
      (total, section) => total + section.items.length,
      0,
    ) > 500,
  );
  assert.ok(STICKER_CATALOG.length >= 40);
  assert.ok(ICON_CATALOG.length >= 60);
  assert.ok(getEmojiCatalogItem(DEFAULT_EMOJI_SELECTION));

  const keys = [
    ...EMOJI_CATALOG_SECTIONS.flatMap((section) => section.items),
    ...STICKER_CATALOG,
    ...ICON_CATALOG,
  ].map((item) => `${item.kind}:${item.value}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("recent picker history is validated, deduplicated, ordered, and bounded", () => {
  const normalized = normalizeEmojiRecents([
    { kind: "emoji", value: "😊" },
    { kind: "emoji", value: "😊" },
    { kind: "sticker", value: "🐂📈" },
    { kind: "icon", value: "unknown" },
    null,
    "bad",
  ]);
  assert.deepEqual(normalized, [
    { kind: "emoji", value: "😊" },
    { kind: "sticker", value: "🐂📈" },
  ]);

  let recents = normalized;
  for (const section of EMOJI_CATALOG_SECTIONS) {
    for (const item of section.items) {
      recents = pushEmojiRecent(recents, {
        kind: item.kind,
        value: item.value,
      });
    }
  }
  assert.equal(recents.length, MAX_EMOJI_RECENTS);

  recents = pushEmojiRecent(recents, DEFAULT_EMOJI_SELECTION);
  assert.deepEqual(recents[0], DEFAULT_EMOJI_SELECTION);
  assert.equal(
    recents.filter(
      (item) =>
        item.kind === DEFAULT_EMOJI_SELECTION.kind &&
        item.value === DEFAULT_EMOJI_SELECTION.value,
    ).length,
    1,
  );
});
