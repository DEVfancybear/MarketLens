import assert from "node:assert/strict";
import test from "node:test";
import {
  projectExecutionInstrumentsToMt5Symbols,
  retainStableMt5SymbolCatalog,
} from "../../src/services/execution/instrumentProjection";

test("projects the durable execution registry into order-safe MT5 metadata", () => {
  const projected = projectExecutionInstrumentsToMt5Symbols(
    {
      accountId: "mt5_ftmo",
      instruments: [
        {
          canonicalSymbol: "BTCUSD",
          venueSymbol: "BTCUSD.cash",
          quantityUnit: "lots",
          quantityStep: "0.01",
          minQuantity: "0.01",
          maxQuantity: "100",
          priceTick: "0.01",
          tickValuePerQuantity: "0.5",
          minStopDistance: "1.25",
          tradeAllowed: true,
        },
      ],
      mappings: [
        {
          canonicalSymbol: "BTCUSD",
          venueSymbol: "BTCUSD.cash",
          mappingSource: "user",
        },
      ],
    },
    123_456,
  );

  assert.deepEqual(projected.BTCUSD, {
    chartSymbol: "BTCUSD",
    brokerSymbol: "BTCUSD.cash",
    digits: 2,
    point: 0.01,
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    brokerMaxLot: 100,
    tickSize: 0.01,
    tickValue: 0.5,
    tickValueLoss: 0.5,
    tickValueProfit: 0.5,
    minStopDistance: 1.25,
    tradeMode: "full",
    updatedAt: 123_456,
  });
});

test("mapping overrides the broker canonical symbol and invalid metadata fails closed", () => {
  const projected = projectExecutionInstrumentsToMt5Symbols({
    accountId: "mt5_broker",
    instruments: [
      {
        canonicalSymbol: "XAUUSDm",
        venueSymbol: "XAUUSDm",
        quantityUnit: "lots",
        quantityStep: "0.1",
        minQuantity: "0.1",
        maxQuantity: "50",
        priceTick: "1e-2",
        tradeAllowed: false,
      },
      {
        canonicalSymbol: "BROKEN",
        venueSymbol: "BROKEN",
        quantityUnit: "lots",
        quantityStep: "0",
        minQuantity: "0.01",
        maxQuantity: "1",
        priceTick: "0.01",
        tradeAllowed: true,
      },
    ],
    mappings: [
      {
        canonicalSymbol: "XAUUSD",
        venueSymbol: "XAUUSDm",
        mappingSource: "user",
      },
    ],
  });

  assert.equal(projected.XAUUSD.brokerSymbol, "XAUUSDm");
  assert.equal(projected.XAUUSD.digits, 2);
  assert.equal(projected.XAUUSD.tradeMode, "disabled");
  assert.equal(projected.BROKEN, undefined);
});

test("heartbeat refresh preserves catalog identity until broker metadata changes", () => {
  const registry = {
    accountId: "mt5_ftmo",
    instruments: [
      {
        canonicalSymbol: "BTCUSD",
        venueSymbol: "BTCUSD",
        quantityUnit: "lots" as const,
        quantityStep: "0.01",
        minQuantity: "0.01",
        maxQuantity: "5",
        priceTick: "0.01",
        tickValuePerQuantity: "0.01",
        tradeAllowed: true,
      },
    ],
    mappings: [],
  };
  const current = projectExecutionInstrumentsToMt5Symbols(registry, 100);
  const heartbeatOnly = projectExecutionInstrumentsToMt5Symbols(registry, 200);
  assert.equal(
    retainStableMt5SymbolCatalog(current, heartbeatOnly),
    current,
  );

  const changed = projectExecutionInstrumentsToMt5Symbols(
    {
      ...registry,
      instruments: [{ ...registry.instruments[0], maxQuantity: "10" }],
    },
    300,
  );
  assert.equal(retainStableMt5SymbolCatalog(current, changed), changed);
});
