"use client";

import { useAtomValue } from "jotai";
import { CircleDot, Server } from "lucide-react";
import {
  executionAccountsAtom,
  selectedExecutionAccountAtom,
} from "@/store/executionRegistryStore";
import { cn } from "@/utils/cn";
import { fmtMoney } from "@/utils/format";

const STATUS_STYLE = {
  disabled: "bg-terminal-hover text-ink-faint",
  offline: "bg-terminal-hover text-ink-muted",
  connecting: "bg-choch/15 text-choch",
  ready: "bg-bull/15 text-bull",
  degraded: "bg-choch/15 text-choch",
  blocked: "bg-bear/15 text-bear",
} as const;

/** Broker-neutral status projection populated by the execution account registry. */
export function ExecutionConnectionStatus() {
  const accounts = useAtomValue(executionAccountsAtom);
  const selected = useAtomValue(selectedExecutionAccountAtom);

  if (!selected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-faint">
        <Server size={12} aria-hidden="true" />
        {accounts.length === 0 ? "Attach EA to add account" : "Select account"}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-[10px]">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold uppercase",
          STATUS_STYLE[selected.status],
        )}
        role="status"
        aria-live="polite"
      >
        <CircleDot size={10} aria-hidden="true" />
        {selected.status}
      </span>
      <span className="max-w-32 truncate font-semibold text-ink">
        {selected.label}
      </span>
      <span className="text-ink-faint">{selected.brokerCode}</span>
      {selected.equity != null && (
        <span className="tabular font-semibold text-ink">
          {fmtMoney(selected.equity)}
        </span>
      )}
    </div>
  );
}
