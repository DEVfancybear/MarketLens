export interface ExecutionActivityIdentity {
  accountId?: string;
  dedupeKey?: string;
  time: number;
}

export const EXECUTION_ACTIVITY_CLEAR_STORAGE_KEY =
  "smc:execution-activity-clear:v1";

export function shouldAppendExecutionActivity(
  current: ExecutionActivityIdentity[],
  entry: ExecutionActivityIdentity,
  clearCutoffs: Readonly<Record<string, number>>,
): boolean {
  if (
    entry.accountId &&
    entry.time <= (clearCutoffs[entry.accountId] ?? 0)
  ) {
    return false;
  }
  if (!entry.dedupeKey) return true;
  return !current.some(
    (candidate) =>
      candidate.accountId === entry.accountId &&
      candidate.dedupeKey === entry.dedupeKey,
  );
}

export function clearExecutionActivityForAccount<
  T extends ExecutionActivityIdentity,
>(current: T[], accountId: string): T[] {
  return current.filter((entry) => entry.accountId !== accountId);
}

export function parseExecutionActivityClearCutoffs(
  raw: string | null,
): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, number] =>
            entry[0].length > 0 &&
            entry[0].length <= 128 &&
            typeof entry[1] === "number" &&
            Number.isFinite(entry[1]) &&
            entry[1] > 0,
        )
        .sort((left, right) => right[1] - left[1])
        .slice(0, 100),
    );
  } catch {
    return {};
  }
}
