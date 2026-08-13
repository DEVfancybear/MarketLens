"use client";

import { atom } from "jotai";
import type {
  CopyTargetDraft,
  ExecutionAccountSummary,
} from "@/types/execution";
import {
  normalizeCopyRoutes,
  type CopyRoutes,
} from "../services/execution/copierPreferences";

/** Broker-neutral projection populated from the Rust execution API. */
export const executionAccountsAtom = atom<ExecutionAccountSummary[]>([]);
export interface ExecutionConnectorCapabilities {
  mt5Managed: boolean;
}
export const executionConnectorCapabilitiesAtom =
  atom<ExecutionConnectorCapabilities>({ mt5Managed: false });
export interface ExecutionAccountLayoutState {
  itemIds: string[];
  revision: number;
}
export const executionAccountLayoutAtom = atom<ExecutionAccountLayoutState>({
  itemIds: [],
  revision: 0,
});
export const executionAccountLayoutPendingAtom = atom(false);
export const applyExecutionAccountLayoutAtom = atom(
  null,
  (
    get,
    set,
    layout: ExecutionAccountLayoutState,
  ) => {
    if (get(executionAccountLayoutPendingAtom)) return;
    if (layout.revision < get(executionAccountLayoutAtom).revision) return;
    set(executionAccountLayoutAtom, layout);
  },
);
export const selectedExecutionAccountIdAtom = atom<string | null>(null);
export const selectedExecutionAccountAtom = atom((get) => {
  const selectedId = get(selectedExecutionAccountIdAtom);
  return (
    get(executionAccountsAtom).find((account) => account.id === selectedId) ??
    null
  );
});
export const copyRoutesAtom = atom<CopyRoutes>({});
export const copyRoutesHydratedAtom = atom(false);

/** Copy drafts for the currently selected source account. */
export const copyTargetsAtom = atom(
  (get): Record<string, CopyTargetDraft> => {
    const sourceId = get(selectedExecutionAccountIdAtom);
    if (!sourceId) return {};
    return get(copyRoutesAtom)[sourceId] ?? {};
  },
  (get, set, targets: Record<string, CopyTargetDraft>) => {
    const sourceId = get(selectedExecutionAccountIdAtom);
    if (!sourceId) return;
    const routes = { ...get(copyRoutesAtom) };
    if (Object.keys(targets).length === 0) {
      delete routes[sourceId];
    } else {
      routes[sourceId] = targets;
    }
    set(copyRoutesAtom, routes);
  },
);

export const applyCopyRoutesAtom = atom(null, (_get, set, routes: unknown) => {
  set(copyRoutesAtom, normalizeCopyRoutes(routes));
  set(copyRoutesHydratedAtom, true);
});

export const resetCopyRoutesAtom = atom(null, (_get, set) => {
  set(copyRoutesAtom, {});
  set(copyRoutesHydratedAtom, false);
});

/** Clears every execution-registry projection owned by the current user. */
export const resetExecutionRegistryAtom = atom(null, (_get, set) => {
  set(executionAccountsAtom, []);
  set(executionConnectorCapabilitiesAtom, { mt5Managed: false });
  set(executionAccountLayoutAtom, { itemIds: [], revision: 0 });
  set(executionAccountLayoutPendingAtom, false);
  set(selectedExecutionAccountIdAtom, null);
  set(copyRoutesAtom, {});
  set(copyRoutesHydratedAtom, false);
});

export const applyExecutionConnectorCapabilitiesAtom = atom(
  null,
  (_get, set, capabilities: ExecutionConnectorCapabilities) => {
    set(executionConnectorCapabilitiesAtom, capabilities);
  },
);

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
    const sourceId = get(selectedExecutionAccountIdAtom);
    if (!sourceId || patch.accountId === sourceId) return;
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
