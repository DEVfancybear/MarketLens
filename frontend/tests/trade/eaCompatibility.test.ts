import assert from "node:assert/strict";
import test from "node:test";
import {
  eaUpgradeLabel,
  executionAccountBlockReason,
} from "../../src/services/execution/eaCompatibility";
import type { ExecutionAccountSummary } from "../../src/types/execution";

const outdatedAccount: ExecutionAccountSummary = {
  id: "mt5_account",
  label: "Broker 1",
  venueKind: "metatrader5",
  brokerCode: "broker",
  externalAccountRef: "1",
  mode: "live",
  status: "blocked",
  statusReason: "ea_update_required",
  currency: "USD",
  tradeAllowed: true,
  eaVersion: "1.24",
  requiredEaVersion: "1.25",
};

test("shows the gateway-required EA version in compatibility guidance", () => {
  assert.equal(eaUpgradeLabel(outdatedAccount), "EA 1.24 → Update 1.25+");
  assert.match(
    executionAccountBlockReason(outdatedAccount) ?? "",
    /Install MarketLensExecutionEA 1\.25 or newer/,
  );
});

test("allows a ready trade-enabled MT5 account", () => {
  assert.equal(
    executionAccountBlockReason({
      ...outdatedAccount,
      status: "ready",
      statusReason: undefined,
      eaVersion: "1.25",
    }),
    null,
  );
});
