const LEGACY_SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  BTCUSDT: "BTCUSD",
  ETHUSDT: "ETHUSD",
  ETCUSD: "ETHUSD",
};

export function legacySymbolAliases(): Readonly<Record<string, string>> {
  return LEGACY_SYMBOL_ALIASES;
}

export function resolveCatalogSymbolId(
  symbol: string,
  catalogSymbols: ReadonlySet<string>,
): string | undefined {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return undefined;
  if (catalogSymbols.has(normalized)) return normalized;

  const alias = LEGACY_SYMBOL_ALIASES[normalized]?.trim().toUpperCase();
  return alias && catalogSymbols.has(alias) ? alias : undefined;
}
