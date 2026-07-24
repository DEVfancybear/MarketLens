export function normalizeChartSymbol(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function resolveCurrentChartSymbol({
  remote,
  local,
  localWritePending,
  fallback = "EURUSD",
}: {
  remote: unknown;
  local: unknown;
  localWritePending: boolean;
  fallback?: string;
}): string {
  const remoteSymbol = normalizeChartSymbol(remote) || fallback;
  const localSymbol = normalizeChartSymbol(local);
  return localWritePending && localSymbol ? localSymbol : remoteSymbol;
}
