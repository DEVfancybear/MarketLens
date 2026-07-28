import assert from "node:assert/strict";
import test from "node:test";
import {
  copyTargetAvailability,
  OFFLINE_COPY_TTL_MS,
  previewCopyRoutes,
} from "../../src/services/execution/copyRouting";
import type { ExecutionAccountSummary } from "../../src/types/execution";

const accounts: ExecutionAccountSummary[] = [
  {
    id: "source",
    label: "FTMO",
    venueKind: "metatrader5",
    brokerCode: "ftmo",
    externalAccountRef: "1001",
    mode: "demo",
    status: "ready",
    currency: "USD",
    equity: 10_000,
    tradeAllowed: true,
  },
  {
    id: "target-a",
    label: "Exness",
    venueKind: "metatrader5",
    brokerCode: "exness",
    externalAccountRef: "2001",
    mode: "demo",
    status: "ready",
    currency: "USD",
    equity: 5_000,
    tradeAllowed: true,
  },
  {
    id: "target-b",
    label: "Offline account",
    venueKind: "metatrader5",
    brokerCode: "other",
    externalAccountRef: "3001",
    mode: "demo",
    status: "offline",
    currency: "USD",
    equity: 20_000,
    tradeAllowed: true,
  },
];

test("previews each copy target independently", () => {
  const result = previewCopyRoutes({
    sourceAccountId: "source",
    sourceQuantity: 1,
    sourceEquity: 10_000,
    accounts,
    quantitySteps: { "target-a": 0.01, "target-b": 0.01 },
    targets: [
      {
        accountId: "target-a",
        enabled: true,
        allocationMode: "equityProportional",
        multiplier: 1,
      },
      {
        accountId: "target-b",
        enabled: true,
        allocationMode: "sameQuantity",
        multiplier: 1,
      },
    ],
  });

  assert.deepEqual(result, [
    {
      accountId: "target-a",
      status: "ready",
      quantity: 0.5,
      allocationMode: "equityProportional",
    },
    {
      accountId: "target-b",
      status: "waiting",
      expiresInMs: 300_000,
    },
  ]);
});

test("floors quantity to the target step and respects the target cap", () => {
  const [result] = previewCopyRoutes({
    sourceAccountId: "source",
    sourceQuantity: 0.37,
    accounts,
    quantitySteps: { "target-a": 0.1 },
    targets: [
      {
        accountId: "target-a",
        enabled: true,
        allocationMode: "multiplier",
        multiplier: 2,
        maxQuantity: 0.65,
      },
    ],
  });

  assert.deepEqual(result, {
    accountId: "target-a",
    status: "ready",
    quantity: 0.6,
    allocationMode: "multiplier",
  });
});

test("offline MT5 targets remain selectable for the five-minute delivery window", () => {
  const availability = copyTargetAvailability(accounts[2]!);

  assert.equal(OFFLINE_COPY_TTL_MS, 300_000);
  assert.equal(availability.eligible, true);
  assert.equal(availability.mode, "waiting");
  assert.match(availability.detail, /within 5 minutes/);
});

test("online targets without trading permission remain blocked", () => {
  const availability = copyTargetAvailability({
    ...accounts[1]!,
    tradeAllowed: false,
    statusReason: "broker_trading_disabled",
  });

  assert.equal(availability.eligible, false);
  assert.equal(availability.mode, "blocked");
  assert.equal(availability.label, "Trading disabled");
});
