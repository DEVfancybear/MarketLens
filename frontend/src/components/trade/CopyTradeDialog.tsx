"use client";

import { useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  LoaderCircle,
  RadioTower,
} from "lucide-react";
import { PlatformContentDialog } from "@/components/ui/PlatformDialog";
import {
  routeExecutionOrder,
  type ExecutionTargetSubmission,
} from "@/services/api/resources/executionApi";
import { makeClientCommandId } from "@/services/execution/identifiers";
import {
  buildExecutionCopyRequest,
  copyableTradeOrder,
  type CopyableMt5Trade,
} from "@/services/execution/orderRouting";
import {
  copyTargetsAtom,
  executionAccountsAtom,
  selectedExecutionAccountAtom,
} from "@/store/executionRegistryStore";
import { addMt5LogAtom } from "@/store/mt5Store";
import { pushToastAtom } from "@/store/toastStore";
import type {
  CopyAllocationMode,
  CopyTargetDraft,
  ExecutionAccountSummary,
} from "@/types/execution";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
import { copyTargetAvailability } from "@/services/execution/copyRouting";

export type { CopyableMt5Trade };

export function CopyTradeDialog({
  trade,
  onClose,
}: {
  trade: CopyableMt5Trade;
  onClose: () => void;
}) {
  const accounts = useAtomValue(executionAccountsAtom);
  const source = useAtomValue(selectedExecutionAccountAtom);
  const configuredTargets = useAtomValue(copyTargetsAtom);
  const addLog = useSetAtom(addMt5LogAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const available = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.id !== source?.id && account.venueKind === "metatrader5",
      ),
    [accounts, source?.id],
  );
  const selectableIds = useMemo(
    () =>
      available
        .filter((account) => copyTargetAvailability(account).eligible)
        .map((account) => account.id),
    [available],
  );
  const defaultIds = useMemo(() => {
    const configured = selectableIds.filter(
      (accountId) => configuredTargets[accountId]?.enabled,
    );
    return configured.length > 0 ? configured : selectableIds;
  }, [configuredTargets, selectableIds]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(defaultIds),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const selectedCount = selectableIds.filter((accountId) =>
    selectedIds.has(accountId),
  ).length;

  if (!source) return null;

  const summary = tradeSummary(trade);
  const submit = async () => {
    if (submittingRef.current || selectedIds.size === 0) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    const commandId = makeClientCommandId("exec_copy");
    try {
      const targets = available
        .filter(
          (account) =>
            selectedIds.has(account.id) &&
            copyTargetAvailability(account).eligible,
        )
        .map((account) =>
          targetDraft(account.id, configuredTargets[account.id]),
        );
      const request = buildExecutionCopyRequest({
        order: copyableTradeOrder(trade, commandId),
        source,
        targets,
      });
      const response = await routeExecutionOrder(request);
      const queued = response.targets.filter(
        (target) => target.status === "queued",
      );
      const waiting = response.targets.filter(
        (target) => target.status === "waiting",
      );
      const propRiskCapped = queued.filter((target) =>
        target.warnings.includes("QUANTITY_CAPPED_BY_PROP_RISK"),
      );
      const rejected = response.targets.filter(
        (
          target,
        ): target is Extract<
          ExecutionTargetSubmission,
          { status: "rejected" | "unavailable" }
        > => target.status === "rejected" || target.status === "unavailable",
      );
      const accepted = queued.length + waiting.length;
      addLog({
        accountId: source.id,
        level: rejected.length > 0 ? "warn" : "info",
        direction: "gateway",
        type: "order.copy",
        message: `${queued.length} queued, ${waiting.length} waiting, ${rejected.length} rejected`,
        requestId: commandId,
        clientOrderId: commandId,
      });
      if (accepted > 0) {
        pushToast({
          title:
            rejected.length > 0
              ? "Trade partially accepted"
              : waiting.length > 0
                ? `Waiting for ${waiting.length} offline account${waiting.length === 1 ? "" : "s"}`
                : propRiskCapped.length > 0
                  ? "Risk Guard adjusted copied quantity"
                  : `Trade copied to ${queued.length} account${queued.length === 1 ? "" : "s"}`,
          message:
            [
              ...queued.map((target) =>
                `${accountName(accounts, target.accountId)}${target.warnings.includes("QUANTITY_CAPPED_BY_PROP_RISK") ? ": quantity auto-reduced to protected risk" : ""}`,
              ),
              ...waiting.map(
                (target) =>
                  `${accountName(accounts, target.accountId)}: open MT5 before ${formatDeadline(target.expiresAtMs)}`,
              ),
              ...rejected.map(
                (target) =>
                  `${accountName(accounts, target.accountId)}: ${target.message}`,
              ),
            ].join(" · "),
          variant:
            rejected.length > 0 ||
            waiting.length > 0 ||
            propRiskCapped.length > 0
              ? "warn"
              : "success",
        });
        onClose();
        return;
      }
      const message =
        rejected
          .map((target) => `${accountName(accounts, target.accountId)}: ${target.message}`)
          .join(" · ") || "No target accepted the copied trade.";
      setError(message);
      pushToast({
        title: "Trade copy rejected",
        message,
        variant: "error",
      });
    } catch (cause) {
      const message = userFacingErrorMessage(
        cause,
        "The copied trade was not accepted by the execution queue.",
      );
      setError(message);
      pushToast({
        title: "Trade copy failed",
        message,
        variant: "error",
      });
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <PlatformContentDialog
      open
      onClose={busy ? () => undefined : onClose}
      title={`Copy ${summary.kindLabel}`}
      description="Create new broker orders on one or more target accounts."
      closeLabel="Close copy trade dialog"
      footer={
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || selectedCount === 0}
            onClick={() => void submit()}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
          >
            {busy ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Copy size={15} />
            )}
            Copy to {selectedCount} account
            {selectedCount === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <section className="grid grid-cols-2 gap-2 rounded-xl border border-brand/25 bg-brand/5 p-3 sm:grid-cols-4">
          <SummaryItem label="Source" value={source.label} />
          <SummaryItem label="Trade" value={`${summary.side} ${summary.symbol}`} />
          <SummaryItem label="Type" value={summary.type} />
          <SummaryItem label="Volume" value={summary.volume} />
        </section>

        <div className="flex items-center justify-between gap-3">
          <div>
            <strong className="block text-xs text-ink">Target accounts</strong>
            <p className="mt-0.5 text-[10px] leading-4 text-ink-muted">
              Each target is validated and queued independently.
            </p>
          </div>
          <button
            type="button"
            disabled={busy || selectableIds.length === 0}
            onClick={() =>
              setSelectedIds((current) =>
                selectedCount === selectableIds.length
                  ? new Set()
                  : new Set(selectableIds),
              )
            }
            className="min-h-8 rounded-lg px-2.5 text-[10px] font-semibold text-brand hover:bg-brand/10 disabled:opacity-50 focus-ring"
          >
            {selectedCount === selectableIds.length
              ? "Clear all"
              : "Select all available"}
          </button>
        </div>

        <fieldset className="space-y-2">
          <legend className="sr-only">Select copy target accounts</legend>
          {available.length === 0 && (
            <div className="rounded-xl border border-dashed border-terminal-border-strong px-4 py-6 text-center text-[11px] text-ink-muted">
              Connect another MT5 account before copying this trade.
            </div>
          )}
          {available.map((account) => {
            const availability = copyTargetAvailability(account);
            const selectable = availability.eligible;
            const checked = selectable && selectedIds.has(account.id);
            const target = targetDraft(account.id, configuredTargets[account.id]);
            return (
              <label
                key={account.id}
                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  checked
                    ? "border-brand/45 bg-brand/10"
                    : "border-terminal-border bg-terminal-panel-2/40"
                } ${selectable ? "cursor-pointer hover:border-terminal-border-strong" : "cursor-not-allowed opacity-55"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!selectable || busy}
                  onChange={(event) => {
                    const next = new Set(selectedIds);
                    if (event.target.checked) next.add(account.id);
                    else next.delete(account.id);
                    setSelectedIds(next);
                  }}
                  className="h-4 w-4 shrink-0 accent-[var(--accent)] focus-ring"
                />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[11px] text-ink">
                    {account.label}
                  </strong>
                  <span className="mt-0.5 block truncate text-[9px] text-ink-muted">
                    {account.server ?? account.brokerCode} · {account.externalAccountRef}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[9px]">
                  {availability.mode === "ready" ? (
                    <>
                      <Check size={11} className="text-bull" />
                      <span className="text-ink-muted">
                        {allocationLabel(target)}
                      </span>
                    </>
                  ) : availability.mode === "waiting" ? (
                    <>
                      <Clock3 size={11} className="text-amber-400" />
                      <span className="text-amber-300">Wait up to 5 min</span>
                    </>
                  ) : (
                    <>
                      <RadioTower size={11} className="text-bear" />
                      <span className="text-bear">{availability.label}</span>
                    </>
                  )}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-[10px] leading-4 text-ink-muted">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          <p>
            This is a one-time copy and creates new broker orders. It does not
            automatically mirror later close, cancel, or modify actions. Absolute
            entry, stop-loss, and take-profit prices are revalidated for every target.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-bear/30 bg-bear/10 px-3 py-2 text-[10px] leading-4 text-bear"
          >
            {error}
          </p>
        )}
      </div>
    </PlatformContentDialog>
  );
}

function tradeSummary(trade: CopyableMt5Trade) {
  if (trade.kind === "pendingOrder") {
    return {
      kindLabel: "pending order",
      symbol: trade.order.symbol,
      side: trade.order.side.toUpperCase(),
      type: trade.order.type,
      volume: trade.order.volume.toFixed(4),
    };
  }
  return {
    kindLabel: "position",
    symbol: trade.position.symbol,
    side: trade.position.side.toUpperCase(),
    type: "market",
    volume: trade.position.volume.toFixed(4),
  };
}

function targetDraft(
  accountId: string,
  configured?: CopyTargetDraft,
): CopyTargetDraft {
  return configured
    ? { ...configured, accountId, enabled: true }
    : {
        accountId,
        enabled: true,
        allocationMode: "sameQuantity",
        multiplier: 1,
      };
}

function allocationLabel(target: CopyTargetDraft): string {
  const labels: Record<CopyAllocationMode, string> = {
    sameQuantity: "Same quantity",
    multiplier: `${target.multiplier}×`,
    equityProportional: `Equity × ${target.multiplier}`,
    riskPercent: `${((target.riskBasisPoints ?? 50) / 100).toFixed(2)}% risk`,
  };
  return labels[target.allocationMode];
}

function accountName(
  accounts: ExecutionAccountSummary[],
  accountId: string,
): string {
  return accounts.find((account) => account.id === accountId)?.label ?? accountId;
}

function formatDeadline(expiresAtMs: number): string {
  return new Date(expiresAtMs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9px] uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <strong className="mt-0.5 block truncate text-[11px] capitalize text-ink">
        {value}
      </strong>
    </div>
  );
}
