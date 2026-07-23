import {
  resolveCatalogMarketSymbolId,
  resolveCatalogSymbolId,
  symbolAliasCandidates,
  symbolsShareBrokerIdentity,
  type SymbolCatalogIdentity,
} from "./market-data/symbolAliases";

/** Canonical alert identity used by quote stores, MT5 requests, and persistence. */
export function normalizeAlertSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Resolve a symbol against keys already observed from a live feed. Exact
 * spellings and known aliases win; broker prefix/suffix variants are accepted
 * only when the observed key is unique, so a symbol cannot silently borrow a
 * quote from the wrong account-specific instrument.
 */
export function resolveObservedSymbol(
  symbol: string,
  availableSymbols: Iterable<string>,
): string | undefined {
  const available = [...new Set(
    [...availableSymbols]
      .map(normalizeAlertSymbol)
      .filter(Boolean),
  )];
  const candidates = symbolAliasCandidates(symbol);
  const exact = candidates.find((candidate) => available.includes(candidate));
  if (exact) return exact;
  const matches = available.filter((candidate) =>
    candidates.some((requested) =>
      symbolsShareBrokerIdentity(requested, candidate),
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolve legacy/provider variants only when the current MT5 catalog proves
 * the replacement exists. Metadata-based matches fail closed when ambiguous.
 */
export function resolveAlertSymbol(
  symbol: string,
  catalogSymbols: ReadonlySet<string> | readonly SymbolCatalogIdentity[],
): string | undefined {
  const normalized = normalizeAlertSymbol(symbol);
  return Array.isArray(catalogSymbols)
    ? resolveCatalogMarketSymbolId(
        normalized,
        catalogSymbols as readonly SymbolCatalogIdentity[],
      )
    : resolveCatalogSymbolId(
        normalized,
        catalogSymbols as ReadonlySet<string>,
      );
}

/** Compare symbols across the legacy aliases used by persisted alert rows. */
export function alertSymbolsEqual(
  left: string,
  right: string,
  catalogSymbols?: ReadonlySet<string> | readonly SymbolCatalogIdentity[],
): boolean {
  if (catalogSymbols) {
    const resolvedLeft = resolveAlertSymbol(left, catalogSymbols);
    const resolvedRight = resolveAlertSymbol(right, catalogSymbols);
    if (resolvedLeft && resolvedRight) return resolvedLeft === resolvedRight;
    const catalogSize =
      "size" in catalogSymbols ? catalogSymbols.size : catalogSymbols.length;
    // A populated catalog is authoritative. If either side cannot be
    // resolved uniquely (including an ambiguous broker suffix), do not
    // reconcile a server event into a potentially different local alert.
    if (catalogSize > 0) {
      return normalizeAlertSymbol(left) === normalizeAlertSymbol(right);
    }
  }
  return symbolsShareBrokerIdentity(left, right);
}
