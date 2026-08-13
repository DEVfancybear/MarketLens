"use client";

import { useAtomValue } from "jotai";
import { CircleDot, Server } from "lucide-react";
import {
  executionAccountsAtom,
  selectedExecutionAccountAtom,
} from "@/store/executionRegistryStore";
import { cn } from "@/utils/cn";
import { fmtMoney } from "@/utils/format";
import { eaUpgradeLabel } from "@/services/execution/eaCompatibility";
import { useI18n } from "@/hooks/useI18n";
import { EXECUTION_STATUS_TRANSLATION_KEYS } from "@/i18n/localization";
import type { ExecutionAccountStatus } from "@/types/execution";

const STATUS_STYLE: Record<ExecutionAccountStatus, string> = {
  disabled: "bg-terminal-hover text-ink-faint",
  offline: "bg-terminal-hover text-ink-muted",
  connecting: "bg-choch/15 text-choch",
  queued: "bg-choch/15 text-choch",
  provisioning: "bg-choch/15 text-choch",
  synchronizing: "bg-choch/15 text-choch",
  ready: "bg-bull/15 text-bull",
  degraded: "bg-choch/15 text-choch",
  reconnecting: "bg-choch/15 text-choch",
  credentials_required: "bg-bear/15 text-bear",
  unsupported: "bg-bear/15 text-bear",
  blocked: "bg-bear/15 text-bear",
  disconnected: "bg-terminal-hover text-ink-muted",
};

/** Broker-neutral status projection populated by the execution account registry. */
export function ExecutionConnectionStatus() {
  const accounts = useAtomValue(executionAccountsAtom);
  const selected = useAtomValue(selectedExecutionAccountAtom);
  const { t } = useI18n();

  if (!selected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] text-ink-faint">
        <Server size={12} aria-hidden="true" />
        {accounts.length === 0
          ? t("execution.connection.attachEa")
          : t("execution.connection.selectAccount")}
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
        {t(EXECUTION_STATUS_TRANSLATION_KEYS[selected.status])}
      </span>
      <span className="max-w-32 truncate font-semibold text-ink">
        {selected.label}
      </span>
      <span className="text-ink-faint">{selected.brokerCode}</span>
      {selected.statusReason === "ea_update_required" && (
        <span className="font-semibold text-bear">
          {eaUpgradeLabel(selected)}
        </span>
      )}
      {selected.equity != null && (
        <span className="tabular font-semibold text-ink">
          {fmtMoney(selected.equity)}
        </span>
      )}
    </div>
  );
}
