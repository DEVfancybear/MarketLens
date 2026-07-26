export type AccountDropEdge = "before" | "after";

export function mergeExecutionAccountLayout<T extends { id: string }>(
  accounts: readonly T[],
  persistedItemIds: readonly string[],
): T[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const itemId of persistedItemIds) {
    const account = byId.get(itemId);
    if (!account || seen.has(itemId)) continue;
    seen.add(itemId);
    ordered.push(account);
  }
  for (const account of accounts) {
    if (seen.has(account.id)) continue;
    seen.add(account.id);
    ordered.push(account);
  }
  return ordered;
}

export function moveExecutionAccountItem(
  itemIds: readonly string[],
  sourceId: string,
  targetId: string,
  edge: AccountDropEdge,
): string[] {
  if (sourceId === targetId || !itemIds.includes(sourceId) || !itemIds.includes(targetId)) {
    return [...itemIds];
  }
  const next = itemIds.filter((itemId) => itemId !== sourceId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (edge === "after" ? 1 : 0), 0, sourceId);
  return next;
}
