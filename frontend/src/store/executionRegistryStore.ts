"use client";

import { atom } from "jotai";
import type {
  CopyTargetDraft,
  ExecutionAccountSummary,
} from "@/types/execution";

/** Broker-neutral projection populated from the Rust execution API. */
export const executionAccountsAtom = atom<ExecutionAccountSummary[]>([]);
export const selectedExecutionAccountIdAtom = atom<string | null>(null);
export const selectedExecutionAccountAtom = atom((get) => {
  const selectedId = get(selectedExecutionAccountIdAtom);
  return (
    get(executionAccountsAtom).find((account) => account.id === selectedId) ??
    null
  );
});
export const copyTargetsAtom = atom<Record<string, CopyTargetDraft>>({});

export const applyExecutionAccountsAtom = atom(
  null,
  (get, set, accounts: ExecutionAccountSummary[]) => {
    const normalized = dedupeAccounts(accounts);
    set(executionAccountsAtom, normalized);
    const selected = get(selectedExecutionAccountIdAtom);
    if (selected && normalized.some((account) => account.id === selected)) {
      return;
    }
    set(
      selectedExecutionAccountIdAtom,
      normalized.find((account) => account.status === "ready")?.id ??
        normalized[0]?.id ??
        null,
    );
  },
);

export const setCopyTargetAtom = atom(
  null,
  (
    get,
    set,
    patch: Pick<CopyTargetDraft, "accountId"> & Partial<CopyTargetDraft>,
  ) => {
    const previous = get(copyTargetsAtom)[patch.accountId] ?? {
      accountId: patch.accountId,
      enabled: false,
      allocationMode: "sameQuantity" as const,
      multiplier: 1,
    };
    set(copyTargetsAtom, {
      ...get(copyTargetsAtom),
      [patch.accountId]: { ...previous, ...patch },
    });
  },
);

function dedupeAccounts(
  accounts: ExecutionAccountSummary[],
): ExecutionAccountSummary[] {
  const byId = new Map<string, ExecutionAccountSummary>();
  for (const account of accounts) {
    if (!account.id.trim()) continue;
    byId.set(account.id, account);
  }
  return [...byId.values()];
}
