export const ALERT_SYMBOL_MESSAGE = "OPEN_ALERT_SYMBOL";

export function normalizeAlertSymbol(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9._-]{1,32}$/.test(symbol) ? symbol : undefined;
}

export function alertSymbolFromSearch(search: string): string | undefined {
  return normalizeAlertSymbol(new URLSearchParams(search).get("symbol"));
}

export function alertSymbolFromMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const message = data as { type?: unknown; symbol?: unknown };
  if (message.type !== ALERT_SYMBOL_MESSAGE) return undefined;
  return normalizeAlertSymbol(message.symbol);
}
