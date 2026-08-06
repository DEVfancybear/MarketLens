import { getSettings, patchSettings } from "../api/resources/settingsApi";
import type {
  CopyAllocationMode,
  CopyTargetDraft,
} from "../../types/execution";

export type CopyRoutes = Record<string, Record<string, CopyTargetDraft>>;

export interface TradeCopierPreferences {
  version: 1;
  routes: CopyRoutes;
}

const ALLOCATION_MODES = new Set<CopyAllocationMode>([
  "sameQuantity",
  "fixedQuantity",
  "multiplier",
  "equityProportional",
  "riskPercent",
]);
const RESERVED_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_ACCOUNT_ID_LENGTH = 256;
const MAX_SOURCE_ACCOUNTS = 128;
const MAX_TARGETS_PER_SOURCE = 128;

export const COPIER_NUMERIC_LIMITS = {
  multiplier: { min: 0.000_001, max: 1_000_000 },
  quantity: { min: 0.000_000_01, max: 1_000_000 },
  riskBasisPoints: { min: 1, max: 10_000 },
} as const;

export function normalizeTradeCopierPreferences(
  value: unknown,
): TradeCopierPreferences {
  if (!isRecord(value) || value.version !== 1) {
    return { version: 1, routes: {} };
  }
  return { version: 1, routes: normalizeCopyRoutes(value.routes) };
}

export function normalizeCopyRoutes(value: unknown): CopyRoutes {
  if (!isRecord(value)) return {};

  const routes: CopyRoutes = {};
  let sourceCount = 0;
  for (const [sourceKey, rawTargets] of Object.entries(value)) {
    if (sourceCount >= MAX_SOURCE_ACCOUNTS) break;
    const sourceId = normalizeAccountId(sourceKey);
    if (!sourceId || !isRecord(rawTargets)) continue;

    const targets: Record<string, CopyTargetDraft> = {};
    let targetCount = 0;
    for (const [targetKey, rawTarget] of Object.entries(rawTargets)) {
      if (targetCount >= MAX_TARGETS_PER_SOURCE) break;
      const target = normalizeCopyTarget(sourceId, targetKey, rawTarget);
      if (!target) continue;
      targets[target.accountId] = target;
      targetCount += 1;
    }

    if (Object.keys(targets).length === 0) continue;
    routes[sourceId] = targets;
    sourceCount += 1;
  }
  return routes;
}

export async function loadTradeCopierPreferences(): Promise<CopyRoutes> {
  const settings = await getSettings();
  return normalizeTradeCopierPreferences(settings.ui.tradeCopier).routes;
}

export async function saveTradeCopierPreferences(
  routes: CopyRoutes,
): Promise<void> {
  const preferences: TradeCopierPreferences = {
    version: 1,
    routes: normalizeCopyRoutes(routes),
  };
  await patchSettings({ ui: { tradeCopier: preferences } });
}

function normalizeCopyTarget(
  sourceId: string,
  targetKey: string,
  value: unknown,
): CopyTargetDraft | null {
  if (!isRecord(value)) return null;

  const targetId = normalizeAccountId(targetKey);
  const accountId = normalizeAccountId(value.accountId);
  if (!targetId || !accountId || targetId !== accountId || sourceId === targetId) {
    return null;
  }
  if (typeof value.enabled !== "boolean") return null;
  if (!isAllocationMode(value.allocationMode)) return null;

  const multiplier = boundedFiniteNumber(
    value.multiplier,
    COPIER_NUMERIC_LIMITS.multiplier.min,
    COPIER_NUMERIC_LIMITS.multiplier.max,
  );
  if (multiplier == null) return null;

  const fixedQuantity = boundedFiniteNumber(
    value.fixedQuantity,
    COPIER_NUMERIC_LIMITS.quantity.min,
    COPIER_NUMERIC_LIMITS.quantity.max,
  );
  if (value.allocationMode === "fixedQuantity" && fixedQuantity == null) {
    return null;
  }

  const riskBasisPoints = boundedFiniteNumber(
    value.riskBasisPoints,
    COPIER_NUMERIC_LIMITS.riskBasisPoints.min,
    COPIER_NUMERIC_LIMITS.riskBasisPoints.max,
    true,
  );
  const maxQuantity = boundedFiniteNumber(
    value.maxQuantity,
    COPIER_NUMERIC_LIMITS.quantity.min,
    COPIER_NUMERIC_LIMITS.quantity.max,
  );

  return {
    accountId,
    enabled: value.enabled,
    allocationMode: value.allocationMode,
    multiplier,
    ...(fixedQuantity == null ? {} : { fixedQuantity }),
    ...(riskBasisPoints == null ? {} : { riskBasisPoints }),
    ...(maxQuantity == null ? {} : { maxQuantity }),
  };
}

function normalizeAccountId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const accountId = value.trim();
  if (
    accountId.length === 0 ||
    accountId.length > MAX_ACCOUNT_ID_LENGTH ||
    RESERVED_OBJECT_KEYS.has(accountId)
  ) {
    return null;
  }
  return accountId;
}

function isAllocationMode(value: unknown): value is CopyAllocationMode {
  return typeof value === "string" && ALLOCATION_MODES.has(value as CopyAllocationMode);
}

function boundedFiniteNumber(
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const bounded = Math.min(max, Math.max(min, value));
  return integer ? Math.round(bounded) : bounded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
