import assert from "node:assert/strict";
import test from "node:test";
import { previewCopyRoutes } from "../../src/services/execution/copyRouting";
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
      status: "blocked",
      reason: "TARGET_NOT_READY",
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
