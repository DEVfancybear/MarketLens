import assert from "node:assert/strict";
import test from "node:test";

import type {
  ContinuousCopyGroupView,
  ExecutionAccountSummary,
} from "../../src/types/execution";
import {
  buildContinuousCopyGroupRequest,
  continuousCopyActionAuthorizationPayload,
  continuousCopyActionRequiresTradeAuthorization,
  continuousCopyGroupAuthorizationPayload,
  continuousCopyGroupRequiresTradeAuthorization,
  continuousCopyGroupViewToDraft,
  createContinuousCopyGroupDraft,
  validateContinuousCopyGroupDraft,
} from "../../src/services/execution/continuousCopier";

const accounts: ExecutionAccountSummary[] = [
  account("source", "Source MT5"),
  account("follower", "Follower MT5"),
  account("second", "Second MT5"),
];

test("continuous group defaults choose the selected source and exclude it from followers", () => {
  const draft = createContinuousCopyGroupDraft(accounts, "source");
  assert.equal(draft.group.sourceAccountId, "source");
  assert.equal(draft.group.enabled, false);
  assert.deepEqual(
    draft.targets.map((target) => target.accountId),
    ["follower", "second"],
  );
  assert.equal(draft.group.config.copyPartialCloses, true);
  assert.equal(draft.targets[0]?.enabled, false);
  assert.deepEqual(draft.targets[0]?.config.protection.brokerMarginCap, {
    basis: "balance",
    basisPoints: 3500,
    alert: false,
  });
  assert.equal(draft.targets[0]?.config.protection.trailingStepPoints, 5);
});

test("continuous request mapping keeps revisions, trims filters, and serializes symbol mappings", () => {
  const draft = createContinuousCopyGroupDraft(accounts, "source");
  draft.groupId = "group-1";
  draft.group.expectedRevision = 7;
  draft.group.enabled = true;
  draft.group.name = "  Gold followers  ";
  draft.group.config.sourceCommentPrefix = "  strategy-a  ";
  draft.targets[0]!.expectedRevision = 3;
  draft.targets[0]!.enabled = true;
  draft.targets[0]!.config = {
    ...draft.targets[0]!.config,
    reverseTrade: true,
    symbolMapping: { " xauusd ": " XAUUSDm " },
    allocation: { mode: "fixedQuantity", quantity: "0.25", unit: "lots" },
  };

  const request = buildContinuousCopyGroupRequest(draft);
  assert.deepEqual(request.group, {
    expectedRevision: 7,
    name: "Gold followers",
    sourceAccountId: "source",
    enabled: true,
    config: {
      ...draft.group.config,
      sourceCommentPrefix: "strategy-a",
      sourceMagicFilter: undefined,
    },
  });
  assert.deepEqual(request.targets[0], {
    expectedRevision: 3,
    accountId: "follower",
    enabled: true,
    config: {
      ...draft.targets[0]!.config,
      symbolMapping: { XAUUSD: "XAUUSDm" },
      maxQuantity: undefined,
    },
  });
});

test("continuous enable and resume require authorization over the exact submitted payload", () => {
  const draft = createContinuousCopyGroupDraft(accounts, "source");
  const disabledRequest = buildContinuousCopyGroupRequest(draft);
  assert.equal(
    continuousCopyGroupRequiresTradeAuthorization(disabledRequest),
    false,
  );

  draft.group.enabled = true;
  draft.targets[0]!.enabled = true;
  const enabledRequest = buildContinuousCopyGroupRequest(draft);
  assert.equal(
    continuousCopyGroupRequiresTradeAuthorization(enabledRequest),
    true,
  );
  assert.deepEqual(continuousCopyGroupAuthorizationPayload(enabledRequest), {
    group: enabledRequest.group,
    targets: enabledRequest.targets,
  });

  const resume = {
    groupId: "group-1",
    expectedRevision: 8,
    action: "resume" as const,
  };
  assert.equal(continuousCopyActionRequiresTradeAuthorization(resume), true);
  assert.deepEqual(continuousCopyActionAuthorizationPayload(resume), resume);
  assert.equal(
    continuousCopyActionRequiresTradeAuthorization({
      ...resume,
      action: "pause",
    }),
    false,
  );
});

test("continuous view mapping preserves server revisions and hydrates newly paired followers", () => {
  const view: ContinuousCopyGroupView = {
    group: {
      id: "group-1",
      ownerId: "user-1",
      name: "Gold followers",
      sourceAccountId: "source",
      enabled: true,
      revision: 4,
      appliedRevision: 4,
      runtimeStatus: "active",
      config: createContinuousCopyGroupDraft(accounts, "source").group.config,
      updatedAtMs: 10,
    },
    targets: [
      {
        groupId: "group-1",
        accountId: "follower",
        enabled: true,
        revision: 9,
        appliedRevision: 9,
        runtimeStatus: "active",
        config: createContinuousCopyGroupDraft(accounts, "source").targets[0]!.config,
        updatedAtMs: 10,
      },
    ],
    pendingWork: 2,
    unresolvedErrors: 0,
    activeLinks: 1,
  };
  const draft = continuousCopyGroupViewToDraft(view, accounts);
  assert.equal(draft.groupId, "group-1");
  assert.equal(draft.group.expectedRevision, 4);
  assert.equal(draft.targets[0]?.expectedRevision, 9);
  assert.deepEqual(
    draft.targets.map((target) => target.accountId),
    ["follower", "second"],
  );
  assert.equal(draft.targets[1]?.enabled, false);
});

test("continuous view mapping preserves followers temporarily absent from the registry", () => {
  const base = createContinuousCopyGroupDraft(accounts, "source");
  const view: ContinuousCopyGroupView = {
    group: {
      id: "group-1",
      ownerId: "user-1",
      name: "Durable followers",
      sourceAccountId: "source",
      enabled: false,
      revision: 2,
      appliedRevision: 2,
      runtimeStatus: "paused",
      config: base.group.config,
      updatedAtMs: 10,
    },
    targets: [
      {
        groupId: "group-1",
        accountId: "disconnected-follower",
        enabled: true,
        revision: 5,
        appliedRevision: 5,
        runtimeStatus: "waiting",
        config: base.targets[0]!.config,
        updatedAtMs: 10,
      },
    ],
    pendingWork: 0,
    unresolvedErrors: 0,
    activeLinks: 0,
  };

  const draft = continuousCopyGroupViewToDraft(view, accounts);
  assert.equal(
    draft.targets.find((target) => target.accountId === "disconnected-follower")
      ?.expectedRevision,
    5,
  );
  assert.deepEqual(
    draft.targets.map((target) => target.accountId),
    ["follower", "second", "disconnected-follower"],
  );
});

test("continuous validation blocks unsafe enabled groups", () => {
  const draft = createContinuousCopyGroupDraft(accounts, "source");
  draft.group.enabled = true;
  draft.group.name = " ";
  draft.group.config.staleAfterMs = 0;
  draft.targets[0]!.enabled = true;
  draft.targets[0]!.config.allocation = {
    mode: "fixedQuantity",
    quantity: "0",
    unit: "lots",
  };
  const errors = validateContinuousCopyGroupDraft(draft);
  assert.ok(errors.some((error) => error.includes("Group name")));
  assert.ok(errors.some((error) => error.includes("Stale event")));
  assert.ok(errors.some((error) => error.includes("Fixed follower lot")));
});

test("risk-percent allocation requires initial copied protection", () => {
  const draft = createContinuousCopyGroupDraft(accounts, "source");
  draft.group.config.copyStopLossTakeProfit = false;
  draft.targets[0]!.config.allocation = {
    mode: "riskPercent",
    basisPoints: 100,
  };

  const errors = validateContinuousCopyGroupDraft(draft);
  assert.ok(errors.some((error) => error.includes("Risk-percent allocation")));
});

function account(id: string, label: string): ExecutionAccountSummary {
  return {
    id,
    label,
    venueKind: "metatrader5",
    brokerCode: "mt5",
    externalAccountRef: id,
    mode: "live",
    status: "ready",
    currency: "USD",
    balance: 10_000,
    equity: 10_000,
    tradeAllowed: true,
  };
}
