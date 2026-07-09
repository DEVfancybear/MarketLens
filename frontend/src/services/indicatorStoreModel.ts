import type { PublicIndicatorScript } from "@/services/api/resources/pineScriptsApi";

export function formatPublicBoosts(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(Math.round(value));
}

export function filterPublicIndicatorStore(
  rows: PublicIndicatorScript[],
  query: string,
): PublicIndicatorScript[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    [row.name, row.author, row.sourceCode].some((value) =>
      value.toLowerCase().includes(q),
    ),
  );
}

export function publicIndicatorScriptId(row: Pick<PublicIndicatorScript, "id">) {
  return `store:${row.id}`;
}
