const LEGACY_SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
  ETCUSD: "ETHUSD",
  XAUUSD: "GOLD",
};

export interface SymbolCatalogIdentity {
  id: string;
  base?: string;
  quote?: string;
}

export function legacySymbolAliases(): Readonly<Record<string, string>> {
  return LEGACY_SYMBOL_ALIASES;
}

/**
 * Return the bounded set of known spellings for a symbol.  The MT5 catalog is
 * broker-owned, so aliases must be considered in both directions: an old
 * browser alert may say `BTCUSDT` while the broker exposes `BTCUSD`, or the
 * reverse can happen after a broker/profile change.
 */
export function symbolAliasCandidates(symbol: string): string[] {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];
  const candidates = [normalized];
  const direct = LEGACY_SYMBOL_ALIASES[normalized]?.trim().toUpperCase();
  if (direct && !candidates.includes(direct)) candidates.push(direct);
  for (const [alias, canonical] of Object.entries(LEGACY_SYMBOL_ALIASES)) {
    const normalizedAlias = alias.trim().toUpperCase();
    const normalizedCanonical = canonical.trim().toUpperCase();
    if (
      normalizedCanonical === normalized &&
      !candidates.includes(normalizedAlias)
    ) {
      candidates.push(normalizedAlias);
    }
  }
  return candidates;
}

/** Match exact aliases plus common broker prefix/suffix variants. */
export function symbolsShareBrokerIdentity(
  left: string,
  right: string,
): boolean {
  const leftCandidates = symbolAliasCandidates(left);
  const rightCandidates = symbolAliasCandidates(right);
  return leftCandidates.some((leftCandidate) =>
    rightCandidates.some(
      (rightCandidate) =>
        leftCandidate === rightCandidate ||
        matchesBrokerSymbolVariant(leftCandidate, rightCandidate) ||
        matchesBrokerSymbolVariant(rightCandidate, leftCandidate) ||
        matchesBrokerCurrencyIdentity(leftCandidate, rightCandidate) ||
        matchesBrokerCurrencyIdentity(rightCandidate, leftCandidate),
    ),
  );
}

export function resolveCatalogSymbolId(
  symbol: string,
  catalogSymbols: ReadonlySet<string>,
): string | undefined {
  const available = new Set(
    [...catalogSymbols]
      .map((candidate) => candidate.trim().toUpperCase())
      .filter(Boolean),
  );
  return symbolAliasCandidates(symbol).find((candidate) =>
    available.has(candidate),
  );
}

/**
 * Resolve a persisted chart symbol against broker-owned catalog metadata.
 * Currency metadata handles account-specific spellings such as EURUSDm,
 * EURUSD.raw, BTCUSD.r, or GOLD without guessing from arbitrary prefixes.
 * Ambiguous catalogs deliberately return undefined.
 */
export function resolveCatalogMarketSymbolId(
  symbol: string,
  catalogSymbols: readonly SymbolCatalogIdentity[],
): string | undefined {
  const ids = new Set(
    catalogSymbols
      .map((candidate) => candidate.id.trim().toUpperCase())
      .filter(Boolean),
  );
  const exact = resolveCatalogSymbolId(symbol, ids);
  if (exact) return exact;

  const requested = symbolAliasCandidates(symbol);
  const matches = new Set<string>();
  for (const candidate of catalogSymbols) {
    const id = candidate.id.trim().toUpperCase();
    const base = candidate.base?.trim().toUpperCase() ?? "";
    const quote = candidate.quote?.trim().toUpperCase() ?? "";
    if (!id || !base || !quote) continue;
    const identity = `${base}${quote}`;
    if (!matchesBrokerCurrencyIdentity(id, identity)) continue;
    if (
      requested.some((requestedSymbol) =>
        matchesBrokerCurrencyIdentity(requestedSymbol, identity),
      )
    ) {
      matches.add(id);
    }
  }
  // Indices, equities, and broker CFD symbols often have no currency
  // metadata.  Their broker spelling is still safe to resolve when the
  // catalog contains exactly one recognized prefix/suffix variant (for
  // example `US30.cash` or `AAPL.r`).  Never choose arbitrarily between two
  // variants.
  for (const candidate of catalogSymbols) {
    const id = candidate.id.trim().toUpperCase();
    if (!id) continue;
    if (
      requested.some((requestedSymbol) =>
        matchesBrokerSymbolVariant(id, requestedSymbol) ||
        matchesBrokerSymbolVariant(requestedSymbol, id),
      )
    ) {
      matches.add(id);
    }
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}

function matchesBrokerSymbolVariant(symbol: string, base: string): boolean {
  if (symbol === base || base.length < 3) return symbol === base;
  if (symbol.startsWith(base)) {
    return isBrokerAffix(symbol.slice(base.length));
  }
  if (symbol.endsWith(base)) {
    return isBrokerAffix(symbol.slice(0, -base.length));
  }
  return false;
}

function matchesBrokerCurrencyIdentity(
  symbol: string,
  identity: string,
): boolean {
  return matchesBrokerSymbolVariant(symbol, identity);
}

function isBrokerAffix(value: string): boolean {
  if (!value) return false;
  if (/^[._#-][A-Z0-9._-]{0,11}$/.test(value)) return true;
  return /^(?:M|R|A|I|PRO|RAW|ECN|CASH|STD|MICRO|MINI)$/.test(value);
}
