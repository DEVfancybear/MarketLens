import type {
  ContinuousCopyGroupActionInput,
  ContinuousCopyAllocation,
  ContinuousCopyConfig,
  ContinuousCopyGroupUpsertInput,
  ContinuousCopyGroupView,
  ContinuousCopyProtectionConfig,
  ContinuousCopyTargetConfig,
  ContinuousCopyTargetWrite,
  ExecutionAccountSummary,
} from "@/types/execution";

export type ContinuousCopyGroupDraft = ContinuousCopyGroupUpsertInput;

export function continuousCopyGroupRequiresTradeAuthorization(
  input: ContinuousCopyGroupUpsertInput,
): boolean {
  return input.group.enabled;
}

export function continuousCopyActionRequiresTradeAuthorization(
  input: ContinuousCopyGroupActionInput,
): boolean {
  return input.action === "resume";
}

export function continuousCopyGroupAuthorizationPayload(
  input: ContinuousCopyGroupUpsertInput,
): Record<string, unknown> {
  return {
    ...(input.groupId ? { groupId: input.groupId } : {}),
    group: input.group,
    targets: input.targets,
  };
}

export function continuousCopyActionAuthorizationPayload(
  input: ContinuousCopyGroupActionInput,
): Record<string, unknown> {
  return {
    groupId: input.groupId,
    expectedRevision: input.expectedRevision,
    action: input.action,
  };
}

export const defaultContinuousCopyConfig = (): ContinuousCopyConfig => ({
  copyMarketOrders: true,
  copyPendingOrders: true,
  copyStopLossTakeProfit: true,
  copyModifications: true,
  copyPartialCloses: true,
  maxSlippagePoints: 30,
  staleAfterMs: 30_000,
  reconciliationIntervalMs: 5_000,
});

export const defaultContinuousCopyProtection = (): ContinuousCopyProtectionConfig => ({
  brokerMarginCap: { basis: "balance", basisPoints: 3500, alert: false },
  trailingStopPoints: 0,
  trailingStepPoints: 5,
  trailingStartPoints: 0,
  breakevenTriggerPoints: 0,
  breakevenOffsetPoints: 1,
});

export const defaultContinuousCopyTarget = (
  accountId: string,
): ContinuousCopyTargetWrite => ({
  accountId,
  enabled: false,
  config: {
    allocation: { mode: "sameQuantity" },
    reverseTrade: false,
    symbolMapping: {},
    protection: defaultContinuousCopyProtection(),
  },
});

export function createContinuousCopyGroupDraft(
  accounts: ExecutionAccountSummary[],
  preferredSourceId?: string | null,
): ContinuousCopyGroupDraft {
  const source =
    accounts.find((account) => account.id === preferredSourceId) ??
    accounts.find((account) => account.status === "ready") ??
    accounts[0];
  return {
    group: {
      name: source ? `${source.label} followers` : "New copier group",
      sourceAccountId: source?.id ?? "",
      // A new group is a reviewed draft. Activation is an explicit user action
      // so a partially configured target can never start copying accidentally.
      enabled: false,
      config: defaultContinuousCopyConfig(),
    },
    targets: accounts
      .filter((account) => account.id !== source?.id)
      .map((account) => defaultContinuousCopyTarget(account.id)),
  };
}

export function continuousCopyGroupViewToDraft(
  view: ContinuousCopyGroupView,
  accounts: ExecutionAccountSummary[] = [],
): ContinuousCopyGroupDraft {
  const draft: ContinuousCopyGroupDraft = {
    groupId: view.group.id,
    group: {
      expectedRevision: view.group.revision,
      name: view.group.name,
      sourceAccountId: view.group.sourceAccountId,
      enabled: view.group.enabled,
      config: cloneGroupConfig(view.group.config),
    },
    targets: view.targets.map((target) => ({
      expectedRevision: target.revision,
      accountId: target.accountId,
      enabled: target.enabled,
      config: cloneTargetConfig(target.config),
    })),
  };
  return ensureContinuousCopyTargets(draft, accounts);
}

export function ensureContinuousCopyTargets(
  draft: ContinuousCopyGroupDraft,
  accounts: ExecutionAccountSummary[],
): ContinuousCopyGroupDraft {
  const byAccount = new Map(
    draft.targets.map((target) => [target.accountId, target] as const),
  );
  const registeredTargets = accounts
    .filter((account) => account.id !== draft.group.sourceAccountId)
    .map(
      (account) =>
        byAccount.get(account.id) ?? defaultContinuousCopyTarget(account.id),
    );
  const registeredIds = new Set(accounts.map((account) => account.id));
  const detachedTargets = draft.targets.filter(
    (target) =>
      target.accountId !== draft.group.sourceAccountId &&
      !registeredIds.has(target.accountId),
  );
  return {
    ...draft,
    // Keep server-owned targets that are temporarily absent from the registry.
    // Dropping them here would hide their runtime state and could make a later
    // save unintentionally omit an existing follower configuration.
    targets: [...registeredTargets, ...detachedTargets],
  };
}

export function buildContinuousCopyGroupRequest(
  draft: ContinuousCopyGroupDraft,
): ContinuousCopyGroupUpsertInput {
  const config = draft.group.config;
  return {
    ...(draft.groupId ? { groupId: draft.groupId } : {}),
    group: {
      ...(draft.group.expectedRevision == null
        ? {}
        : { expectedRevision: draft.group.expectedRevision }),
      name: draft.group.name.trim(),
      sourceAccountId: draft.group.sourceAccountId,
      enabled: draft.group.enabled,
      config: {
        ...config,
        ...(config.sourceMagicFilter == null
          ? { sourceMagicFilter: undefined }
          : { sourceMagicFilter: config.sourceMagicFilter }),
        ...(config.sourceCommentPrefix?.trim()
          ? { sourceCommentPrefix: config.sourceCommentPrefix.trim() }
          : { sourceCommentPrefix: undefined }),
      },
    },
    targets: draft.targets.map((target) => ({
      ...(target.expectedRevision == null
        ? {}
        : { expectedRevision: target.expectedRevision }),
      accountId: target.accountId,
      enabled: target.enabled,
      config: {
        ...cloneTargetConfig(target.config),
        maxQuantity: target.config.maxQuantity?.trim() || undefined,
        symbolMapping: Object.fromEntries(
          Object.entries(target.config.symbolMapping)
            .map(([canonical, venue]) => [
              canonical.trim().toUpperCase(),
              venue.trim(),
            ])
            .filter(([canonical, venue]) => canonical && venue),
        ),
      },
    })),
  };
}

export function validateContinuousCopyGroupDraft(
  draft: ContinuousCopyGroupDraft,
): string[] {
  const errors: string[] = [];
  if (!draft.group.name.trim()) errors.push("Group name is required.");
  if (!draft.group.sourceAccountId) errors.push("Choose a source account.");
  if (draft.targets.length === 0) {
    errors.push("Pair at least one follower account.");
  }
  if (
    draft.group.enabled &&
    !draft.targets.some((target) => target.enabled)
  ) {
    errors.push("Enable at least one follower before starting the group.");
  }
  const config = draft.group.config;
  if (!Number.isInteger(config.maxSlippagePoints) || config.maxSlippagePoints < 0) {
    errors.push("Maximum slippage must be zero or a positive whole number.");
  }
  if (!Number.isSafeInteger(config.staleAfterMs) || config.staleAfterMs <= 0) {
    errors.push("Stale event window must be a positive number of milliseconds.");
  }
  if (
    !Number.isSafeInteger(config.reconciliationIntervalMs) ||
    config.reconciliationIntervalMs <= 0
  ) {
    errors.push("Reconciliation interval must be a positive number of milliseconds.");
  }
  if (
    config.sourceMagicFilter != null &&
    !Number.isSafeInteger(config.sourceMagicFilter)
  ) {
    errors.push("Magic filter must be a whole number.");
  }

  const seen = new Set<string>();
  for (const target of draft.targets) {
    if (target.accountId === draft.group.sourceAccountId) {
      errors.push("The source account cannot also be a follower.");
    }
    if (seen.has(target.accountId)) {
      errors.push("Each follower account can appear only once.");
    }
    seen.add(target.accountId);
    validateTarget(target, errors);
    if (
      !config.copyStopLossTakeProfit &&
      target.config.allocation.mode === "riskPercent"
    ) {
      errors.push(
        "Risk-percent allocation requires copied stop-loss protection on the initial order.",
      );
    }
  }
  return [...new Set(errors)];
}

export function continuousCopyAllocationValue(
  allocation: ContinuousCopyAllocation,
): string {
  switch (allocation.mode) {
    case "sameQuantity":
      return "";
    case "fixedQuantity":
      return allocation.quantity;
    case "multiplier":
    case "equityProportional":
      return allocation.multiplier;
    case "riskPercent":
      return String(allocation.basisPoints / 100);
  }
}

function validateTarget(target: ContinuousCopyTargetWrite, errors: string[]) {
  if (!target.accountId) errors.push("Every follower must have an account.");
  const allocation = target.config.allocation;
  if (
    allocation.mode === "fixedQuantity" &&
    !positiveDecimal(allocation.quantity)
  ) {
    errors.push("Fixed follower lot must be greater than zero.");
  }
  if (
    (allocation.mode === "multiplier" ||
      allocation.mode === "equityProportional") &&
    !positiveDecimal(allocation.multiplier)
  ) {
    errors.push("Follower multiplier must be greater than zero.");
  }
  if (
    allocation.mode === "riskPercent" &&
    (!Number.isInteger(allocation.basisPoints) ||
      allocation.basisPoints < 1 ||
      allocation.basisPoints > 10_000)
  ) {
    errors.push("Follower risk must be between 0.01% and 100%.");
  }
  if (
    target.config.maxQuantity &&
    !positiveDecimal(target.config.maxQuantity)
  ) {
    errors.push("Follower maximum lot must be greater than zero.");
  }
  const protection = target.config.protection;
  const cap = protection.brokerMarginCap;
  if (
    cap &&
    (!Number.isInteger(cap.basisPoints) ||
      cap.basisPoints < 1 ||
      cap.basisPoints > 10_000)
  ) {
    errors.push("Broker margin cap must be between 0.01% and 100%.");
  }
  if (
    protection.maxDrawdownBasisPoints != null &&
    (!Number.isInteger(protection.maxDrawdownBasisPoints) ||
      protection.maxDrawdownBasisPoints < 1 ||
      protection.maxDrawdownBasisPoints > 10_000)
  ) {
    errors.push("Maximum drawdown must be between 0.01% and 100%.");
  }
  const pointFields = [
    protection.trailingStopPoints,
    protection.trailingStepPoints,
    protection.trailingStartPoints,
    protection.breakevenTriggerPoints,
    protection.breakevenOffsetPoints,
  ];
  if (pointFields.some((value) => !Number.isInteger(value) || value < 0)) {
    errors.push("Protection distances must be zero or positive whole points.");
  }
  if (protection.trailingStopPoints > 0 && protection.trailingStepPoints === 0) {
    errors.push("Trailing step must be positive when trailing stop is enabled.");
  }
}

function positiveDecimal(value: string): boolean {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
}

function cloneGroupConfig(config: ContinuousCopyConfig): ContinuousCopyConfig {
  return { ...config };
}

function cloneTargetConfig(
  config: ContinuousCopyTargetConfig,
): ContinuousCopyTargetConfig {
  const protection: ContinuousCopyProtectionConfig = {
    ...config.protection,
  };
  if (!config.protection.brokerMarginCap) {
    delete protection.brokerMarginCap;
  } else {
    protection.brokerMarginCap = { ...config.protection.brokerMarginCap };
  }
  return {
    ...config,
    allocation: { ...config.allocation },
    symbolMapping: { ...config.symbolMapping },
    protection,
  };
}
