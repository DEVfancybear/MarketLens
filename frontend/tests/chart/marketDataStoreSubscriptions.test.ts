import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import test from "node:test";
import { createStore } from "jotai/vanilla";
import type {
  MarketCandle,
  MarketQuote,
  MarketSessionStatus,
} from "../../src/types";

type ResolveFilename = (
  request: string,
  parent: unknown,
  isMain: boolean,
  options?: unknown,
) => string;

// `tsc` keeps the app's `@/` paths in CommonJS output. Map them to the
// corresponding compiled test source so this focused store test exercises the
// real atoms rather than a duplicate test model.
const moduleLoader = Module as unknown as { _resolveFilename: ResolveFilename };
const originalResolveFilename = moduleLoader._resolveFilename.bind(Module);
moduleLoader._resolveFilename = (request, parent, isMain, options) =>
  originalResolveFilename(
    request.startsWith("@/")
      ? path.resolve(__dirname, "../../src", request.slice(2))
      : request,
    parent,
    isMain,
    options,
  );

const marketData = require("../../src/store/marketDataStore") as typeof import(
  "../../src/store/marketDataStore"
);

function candle(time: number, close: number): MarketCandle {
  return {
    time,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 10,
  };
}

function quote(symbol: string, last: number): MarketQuote {
  return {
    symbol,
    last,
    change: 0,
    changePct: 0,
    volume: 10,
    timestamp: 1_000,
  };
}

function session(symbol: string, state: "open" | "closed"): MarketSessionStatus {
  return {
    provider: "mt5",
    symbol,
    state,
    scheduledOpen: state === "open",
    serverTime: 1_000,
    observedAt: 1_000,
    receivedAt: 1_000,
  };
}

test("market candle atom ignores writes to unrelated series", () => {
  const store = createStore();
  const eurusd = [candle(60, 1.1)];
  const gbpusd = [candle(60, 1.3)];
  const selectedAtom = marketData.marketCandleSeriesAtom("EURUSD", "1m");

  store.set(marketData.candlesAtom, { "EURUSD:1m": eurusd });
  assert.equal(store.get(selectedAtom), eurusd);

  let notifications = 0;
  const unsubscribe = store.sub(selectedAtom, () => {
    notifications += 1;
  });
  store.set(marketData.candlesAtom, {
    "EURUSD:1m": eurusd,
    "GBPUSD:1m": gbpusd,
  });
  assert.equal(notifications, 0);

  const updated = [candle(60, 1.2)];
  store.set(marketData.candlesAtom, {
    "EURUSD:1m": updated,
    "GBPUSD:1m": gbpusd,
  });
  assert.equal(notifications, 1);
  assert.equal(store.get(selectedAtom), updated);
  unsubscribe();
});

test("market quote and last-price atoms ignore unrelated symbol ticks", () => {
  const store = createStore();
  const eurusd = quote("EURUSD", 1.1);
  const gbpusd = quote("GBPUSD", 1.3);
  store.set(marketData.quotesAtom, { EURUSD: eurusd });

  const quoteAtom = marketData.marketQuoteAtom("eurusd");
  const priceAtom = marketData.marketLastPriceAtom("EURUSD");
  assert.equal(store.get(quoteAtom), eurusd);
  assert.equal(store.get(priceAtom), 1.1);

  let quoteNotifications = 0;
  let priceNotifications = 0;
  const unsubscribeQuote = store.sub(quoteAtom, () => {
    quoteNotifications += 1;
  });
  const unsubscribePrice = store.sub(priceAtom, () => {
    priceNotifications += 1;
  });
  store.set(marketData.quotesAtom, { EURUSD: eurusd, GBPUSD: gbpusd });
  assert.equal(quoteNotifications, 0);
  assert.equal(priceNotifications, 0);

  store.set(marketData.quotesAtom, {
    EURUSD: { ...eurusd, bid: 1.09 },
    GBPUSD: gbpusd,
  });
  assert.equal(quoteNotifications, 1);
  assert.equal(priceNotifications, 0);
  unsubscribeQuote();
  unsubscribePrice();
});

test("market session atom ignores updates to unrelated symbols", () => {
  const store = createStore();
  const eurusd = session("EURUSD", "open");
  const gbpusd = session("GBPUSD", "closed");
  const selectedAtom = marketData.marketSessionAtom("eurusd");
  store.set(marketData.marketSessionsAtom, { EURUSD: eurusd });
  assert.equal(store.get(selectedAtom), eurusd);

  let notifications = 0;
  const unsubscribe = store.sub(selectedAtom, () => {
    notifications += 1;
  });
  store.set(marketData.marketSessionsAtom, {
    EURUSD: eurusd,
    GBPUSD: gbpusd,
  });
  assert.equal(notifications, 0);

  const updated = session("EURUSD", "closed");
  store.set(marketData.marketSessionsAtom, {
    EURUSD: updated,
    GBPUSD: gbpusd,
  });
  assert.equal(notifications, 1);
  assert.equal(store.get(selectedAtom), updated);
  unsubscribe();
});

test("selecting the active market repeatedly keeps one subscription reference", () => {
  const store = createStore();
  const subscriptions: string[] = [];
  const unsubscriptions: string[] = [];
  marketData.attachMarketDataService({
    connect() {},
    disconnect() {},
    subscribe(sub) {
      subscriptions.push(`${sub.symbol}:${sub.timeframe}`);
    },
    unsubscribe(symbol, timeframe) {
      unsubscriptions.push(`${symbol}:${timeframe ?? ""}`);
    },
  });

  store.set(marketData.selectMarketAtom, "EURUSD", "1m");
  store.set(marketData.selectMarketAtom, "EURUSD", "1m");

  assert.equal(store.get(marketData.subRefsAtom)["EURUSD:1m"], 1);
  assert.deepEqual(subscriptions, ["EURUSD:1m"]);
  assert.deepEqual(unsubscriptions, []);

  store.set(marketData.selectMarketAtom, "GBPUSD", "5m");
  assert.equal(store.get(marketData.subRefsAtom)["EURUSD:1m"], undefined);
  assert.equal(store.get(marketData.subRefsAtom)["GBPUSD:5m"], 1);
  assert.deepEqual(subscriptions, ["EURUSD:1m", "GBPUSD:5m"]);
  assert.deepEqual(unsubscriptions, ["EURUSD:1m"]);
  marketData.attachMarketDataService(null);
});
