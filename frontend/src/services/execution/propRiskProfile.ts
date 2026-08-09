import type { PropRiskProfile } from "@/types/execution";

/**
 * Returns an assignment's exact versioned catalog entry. Deliberately does not
 * fall back to the latest version or the first profile: product/stage cannot be
 * inferred safely from broker account metadata.
 */
export function findExactPropRiskProfile(
  profiles: readonly PropRiskProfile[],
  profileId: string,
  profileVersion: number,
): PropRiskProfile | undefined {
  return profiles.find(
    (profile) =>
      profile.id === profileId && profile.version === profileVersion,
  );
}

export function resolveProfileInitialBalance(
  capitalMode: "referenceBalances" | "manual",
  referenceBalances: readonly number[],
  observedBalance: number | undefined,
): number | undefined {
  if (
    observedBalance == null ||
    !Number.isFinite(observedBalance) ||
    observedBalance <= 0
  ) {
    return undefined;
  }
  if (capitalMode === "manual") return observedBalance;
  const candidates = referenceBalances.filter(
    (candidate) => Number.isFinite(candidate) && candidate > 0,
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, candidate) => {
    const bestDistance = Math.abs(observedBalance - best) / best;
    const candidateDistance = Math.abs(observedBalance - candidate) / candidate;
    return candidateDistance < bestDistance ||
      (candidateDistance === bestDistance && candidate > best)
      ? candidate
      : best;
  });
}
