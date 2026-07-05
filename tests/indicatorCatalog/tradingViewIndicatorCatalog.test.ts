import assert from "node:assert/strict";
import { test } from "node:test";

import {
  filterCatalogItems,
  parseTradingViewScriptsHtml,
} from "../../src/services/tradingViewIndicatorCatalog";

const html = `
<article>
  <a href="https://www.tradingview.com/script/abc123-Example-RSI/"
     data-qa-id="ui-lib-card-link-title">Example RSI Strategy</a>
  <address data-qa-id="ui-lib-card-link-author">
    <a href="/u/AuthorOne/"><span>by AuthorOne</span></a>
  </address>
  <button aria-label="1242 boosts"><span>1.2 K</span></button>
</article>
<article>
  <a href="/script/def456-Profile-Tool/"
     data-qa-id="ui-lib-card-link-title">Volume Profile Tool</a>
  <address data-qa-id="ui-lib-card-link-author">
    <a href="/u/ProfileDev/"><span>by ProfileDev</span></a>
  </address>
  <button aria-label="12 boosts"><span>12</span></button>
</article>`;

test("TradingView script parser returns only upstream rows", () => {
  const rows = parseTradingViewScriptsHtml(html, "top");

  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "abc123-Example-RSI");
  assert.equal(rows[0].name, "Example RSI Strategy");
  assert.equal(rows[0].author, "AuthorOne");
  assert.equal(rows[0].boosts, "1.2K");
  assert.equal(rows[0].type, "strategy");
  assert.equal(rows[1].url, "https://www.tradingview.com/script/def456-Profile-Tool/");
  assert.equal(rows[1].type, "profile");
});

test("catalog filtering is query and type based", () => {
  const rows = parseTradingViewScriptsHtml(html, "top");

  assert.equal(filterCatalogItems(rows, "authorone", "all").length, 1);
  assert.equal(filterCatalogItems(rows, "", "strategy").length, 1);
  assert.equal(filterCatalogItems(rows, "", "indicator").length, 0);
});

test("unparseable TradingView HTML stays empty instead of using local fallback data", () => {
  assert.deepEqual(parseTradingViewScriptsHtml("<main></main>", "top"), []);
});
