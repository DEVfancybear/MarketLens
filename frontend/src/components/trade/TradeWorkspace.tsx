"use client";

import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Activity,
  BookOpen,
  Check,
  CircleOff,
  Clipboard,
  Copy,
  Download,
  FileCheck2,
  KeyRound,
  LoaderCircle,
  Plus,
  Radio,
  Server,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { OrderTicket } from "./OrderTicket";
import { PositionsTable } from "./PositionsTable";
import { ExecutionModeSwitch } from "./ExecutionModeSwitch";
import { ExecutionConnectionStatus } from "./ExecutionConnectionStatus";
import { Mt5CommandLog } from "./Mt5CommandLog";
import { Mt5EaSetupGuide } from "./Mt5EaSetupGuide";
import { ExecutionAccountManagementDialog } from "./ExecutionAccountManagementDialog";
import {
  activeSimAccountAtom,
  equityAtom,
  positionsAtom,
  startingEquityAtom,
} from "@/store/tradeStore";
import {
  executionModeAtom,
  mt5AccountAtom,
  mt5PositionsAtom,
  setExecutionModeAtom,
} from "@/store/mt5Store";
import {
  copyTargetsAtom,
  executionAccountsAtom,
  selectedExecutionAccountIdAtom,
  setCopyTargetAtom,
} from "@/store/executionRegistryStore";
import { cn } from "@/utils/cn";
import { fmtMoney } from "@/utils/format";
import type { ExecutionAccountSummary } from "@/types/execution";
import {
  getExecutionInstruments,
  upsertExecutionSymbolMapping,
  type ExecutionAccountInstrumentsWire,
} from "@/services/api/resources/executionApi";
import { symbolAtom } from "@/store/chartStore";
import { executionEaDistribution } from "@/services/execution/eaDistribution";
import { useExecutionPairingToken } from "@/hooks/useExecutionPairingToken";

type WorkspaceTab = "positions" | "copy" | "activity";

export function TradeWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>("positions");
  const equity = useAtomValue(equityAtom);
  const startingEquity = useAtomValue(startingEquityAtom);
  const positions = useAtomValue(positionsAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Account = useAtomValue(mt5AccountAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);

  const openPnl =
    executionMode === "mt5"
      ? mt5Positions.reduce((sum, position) => sum + position.profit, 0)
      : positions
          .filter((position) => position.status === "open")
          .reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const activeEquity =
    executionMode === "mt5" && mt5Account ? mt5Account.equity : equity;
  const accountReturn =
    executionMode === "simulator" && startingEquity > 0
      ? ((activeEquity - startingEquity) / startingEquity) * 100
      : undefined;

  return (
    <main
      id="trade-workspace"
      className="grid h-full min-h-0 grid-cols-[264px_minmax(0,1fr)_336px] gap-2 p-2"
      aria-label="Trade workspace"
    >
      <ExecutionAccountRail />

      <section className="surface-panel flex min-w-0 flex-col overflow-hidden">
        <header className="flex min-h-[68px] shrink-0 items-center gap-5 border-b border-terminal-border bg-terminal-panel px-4">
          <div className="min-w-[150px]">
            <div className="text-[15px] font-bold tracking-[-0.01em] text-ink">
              Trade desk
            </div>
            <div className="mt-0.5 text-[10px] text-ink-faint">
              Orders, positions and copy execution
            </div>
          </div>
          <ExecutionModeSwitch />
          <Metric label="Equity" value={fmtMoney(activeEquity)} />
          <Metric
            label="Open P/L"
            value={fmtMoney(openPnl)}
            tone={openPnl >= 0 ? "positive" : "negative"}
          />
          {accountReturn != null && (
            <Metric
              label="Return"
              value={`${accountReturn >= 0 ? "+" : ""}${accountReturn.toFixed(2)}%`}
              tone={accountReturn >= 0 ? "positive" : "negative"}
            />
          )}
          <div className="ml-auto min-w-0">
            {executionMode === "mt5" ? (
              <ExecutionConnectionStatus />
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-2.5 py-1.5 text-[10px] font-semibold text-brand">
                <Radio size={12} aria-hidden="true" />
                Simulator ready
              </span>
            )}
          </div>
        </header>

        <div
          className="flex h-11 shrink-0 items-end gap-1 border-b border-terminal-border bg-terminal-panel-2/45 px-3"
          role="tablist"
          aria-label="Trade data"
        >
          <WorkspaceTabButton
            active={tab === "positions"}
            icon={<Activity size={13} />}
            onClick={() => setTab("positions")}
          >
            Positions
          </WorkspaceTabButton>
          <WorkspaceTabButton
            active={tab === "copy"}
            icon={<Copy size={13} />}
            onClick={() => setTab("copy")}
          >
            Copy routing
          </WorkspaceTabButton>
          <WorkspaceTabButton
            active={tab === "activity"}
            icon={<ShieldCheck size={13} />}
            onClick={() => setTab("activity")}
          >
            Activity
          </WorkspaceTabButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {tab === "positions" && <PositionsTable />}
          {tab === "copy" && <CopyRoutingPanel />}
          {tab === "activity" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <Mt5CommandLog />
              <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-ink-faint">
                Rust gateway events will appear here per account with a shared
                idempotency key and an independent result for every target.
              </div>
            </div>
          )}
        </div>
        {tab !== "activity" && <Mt5CommandLog />}
      </section>

      <aside
        aria-label="Order ticket"
        className="surface-panel min-h-0 overflow-hidden"
      >
        <OrderTicket variant="workspace" />
      </aside>
    </main>
  );
}

function ExecutionAccountRail() {
  const [showSetup, setShowSetup] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [managedAccount, setManagedAccount] =
    useState<ExecutionAccountSummary | null>(null);
  const executionMode = useAtomValue(executionModeAtom);
  const simAccount = useAtomValue(activeSimAccountAtom);
  const simEquity = useAtomValue(equityAtom);
  const gatewayAccounts = useAtomValue(executionAccountsAtom);
  const selectedGatewayId = useAtomValue(selectedExecutionAccountIdAtom);
  const selectGateway = useSetAtom(selectedExecutionAccountIdAtom);
  const setMode = useSetAtom(setExecutionModeAtom);
  const eaDistribution = executionEaDistribution();
  const {
    pairing,
    pairingFailed,
    pairingLoading,
    createPairingToken,
  } = useExecutionPairingToken();

  const simulator: ExecutionAccountSummary = {
    id: `simulator:${simAccount?.id ?? "local"}`,
    label: simAccount?.name ?? "Simulator",
    venueKind: "simulator",
    brokerCode: "simulator",
    externalAccountRef: simAccount?.id ?? "local",
    mode: "simulated",
    status: "ready",
    currency: simAccount?.currency ?? "USD",
    balance: simEquity,
    equity: simEquity,
    tradeAllowed: true,
  };
  const accounts = [simulator, ...gatewayAccounts];

  const select = (account: ExecutionAccountSummary) => {
    if (account.venueKind === "simulator") {
      setMode("simulator");
      return;
    }
    selectGateway(account.id);
    if (account.venueKind === "metatrader5") setMode("mt5");
  };

  return (
    <aside className="surface-panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-terminal-border px-3">
        <div>
          <div className="text-xs font-bold text-ink">Accounts</div>
          <div className="text-[9px] text-ink-faint">
            {accounts.length} execution {accounts.length === 1 ? "target" : "targets"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowSetup((current) => !current)}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-terminal-border-strong px-2 text-[10px] font-semibold text-ink-muted transition-colors hover:border-brand/45 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <Plus size={12} aria-hidden="true" />
          Add
        </button>
      </div>
      {showSetup && (
        <div className="mx-2 mt-2 rounded-xl border border-brand/25 bg-brand/5 p-3 text-[10px] leading-4 text-ink-muted">
          <strong className="block text-[11px] text-ink">
            Add an MT5 account
          </strong>
          <span className="mt-1 block">
            Open one MT5 terminal per account, attach the common
            SMCExecutionEA, allow the execution URL in WebRequest, then
            enter a one-time pairing token. The account appears here
            automatically.
          </span>
          <div className="mt-2 overflow-hidden rounded-lg border border-brand/25 bg-terminal-bg">
            <div className="flex items-center gap-2 p-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                <Download size={15} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-[10px] text-ink">
                  SMCExecutionEA.ex5
                </strong>
                <span className="block text-[8px] text-ink-faint">
                  One common EA for all MT5 brokers
                </span>
              </span>
            </div>
            <a
              href={eaDistribution.downloadUrl}
              download="SMCExecutionEA.ex5"
              className="mx-2 mb-2 flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand px-2.5 text-[10px] font-semibold text-white transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-terminal-bg"
            >
              <Download size={12} aria-hidden="true" />
              Download MT5 EA
            </a>
            <div className="flex items-center justify-between gap-2 border-t border-terminal-border px-2 py-1.5 text-[8px] text-ink-faint">
              <span>Compiled release</span>
              <a
                href={eaDistribution.checksumUrl}
                download="SMCExecutionEA.sha256.txt"
                className="inline-flex items-center gap-1 font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                <FileCheck2 size={10} aria-hidden="true" />
                SHA-256
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-brand/30 bg-brand/5 px-2.5 text-[10px] font-semibold text-brand transition-colors hover:border-brand/50 hover:bg-brand/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <BookOpen size={12} aria-hidden="true" />
            Hướng dẫn cài đặt
          </button>
          <div className="mt-2 rounded-lg border border-terminal-border bg-terminal-bg p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-ink">EA gateway URL</span>
              <button
                type="button"
                className="rounded p-1 text-brand hover:bg-brand/10"
                aria-label="Copy EA gateway URL"
                onClick={() =>
                  void navigator.clipboard.writeText(eaDistribution.gatewayUrl)
                }
              >
                <Clipboard size={12} />
              </button>
            </div>
            <code className="mt-1 block break-all select-all text-[9px] text-brand">
              {eaDistribution.gatewayUrl}
            </code>
          </div>
          {pairing ? (
            <div className="mt-2 rounded-lg border border-bull/25 bg-bull/5 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-bull">
                  One-time token · expires{" "}
                  {new Date(pairing.expiresAtMs).toLocaleTimeString()}
                </span>
                <button
                  type="button"
                  className="rounded p-1 text-bull hover:bg-bull/10"
                  aria-label="Copy pairing token"
                  onClick={() => void navigator.clipboard.writeText(pairing.token)}
                >
                  <Clipboard size={12} />
                </button>
              </div>
              <code className="mt-1 block break-all select-all text-[9px] text-ink">
                {pairing.token}
              </code>
              <button
                type="button"
                disabled={pairingLoading}
                onClick={() => void createPairingToken()}
                className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg border border-bull/30 px-2 text-[9px] font-semibold text-bull transition-colors hover:bg-bull/10 disabled:opacity-60 focus-ring"
              >
                {pairingLoading ? (
                  <LoaderCircle size={11} className="animate-spin" />
                ) : (
                  <KeyRound size={11} />
                )}
                Generate another token
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={pairingLoading}
              onClick={() => void createPairingToken()}
              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[10px] font-semibold text-white disabled:opacity-60"
            >
              {pairingLoading && (
                <LoaderCircle size={12} className="animate-spin" />
              )}
              Generate 5-minute token
            </button>
          )}
          {pairingFailed && (
            <span className="mt-2 block text-[9px] text-bear">
              Could not issue a pairing token. Try again.
            </span>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {accounts.map((account) => {
          const active =
            account.venueKind === "simulator"
              ? executionMode === "simulator"
              : executionMode === "mt5" && account.id === selectedGatewayId;
          return (
            <div
              key={account.id}
              className={cn(
                "relative w-full rounded-xl border transition-colors",
                active
                  ? "border-brand/50 bg-brand/10"
                  : "border-terminal-border bg-terminal-panel-2/45 hover:border-terminal-border-strong hover:bg-terminal-hover",
              )}
            >
              <button
                type="button"
                onClick={() => select(account)}
                aria-pressed={active}
                className={cn(
                  "w-full p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60",
                  account.venueKind !== "simulator" && "pr-10",
                )}
              >
                <span className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                    account.venueKind === "simulator"
                      ? "bg-brand/15 text-brand"
                      : account.status === "ready"
                        ? "bg-bull/15 text-bull"
                        : "bg-terminal-hover text-ink-faint",
                  )}
                >
                  {account.venueKind === "simulator" ? (
                    <Radio size={14} />
                  ) : (
                    <Server size={14} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <strong className="truncate text-[11px] text-ink">
                      {account.label}
                    </strong>
                    {active && <Check size={12} className="shrink-0 text-brand" />}
                  </span>
                  <span className="mt-0.5 block truncate text-[9px] uppercase tracking-wide text-ink-faint">
                    {account.brokerCode} · {account.mode}
                  </span>
                  <span className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate text-[9px] text-ink-faint">
                      {account.server ?? account.externalAccountRef}
                    </span>
                    <span className="tabular text-[10px] font-semibold text-ink">
                      {account.equity != null ? fmtMoney(account.equity) : "--"}
                    </span>
                  </span>
                </span>
                </span>
              </button>
              {account.venueKind !== "simulator" && (
                <button
                  type="button"
                  onClick={() => setManagedAccount(account)}
                  aria-label={`Quản lý ${account.label}`}
                  title="Quản lý account"
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-terminal-hover hover:text-ink focus-ring"
                >
                  <Settings2 size={14} aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-terminal-border p-3 text-[10px] leading-4 text-ink-faint">
        One MT5 terminal runs one account. Attach the same EA to every terminal
        to populate this list.
      </div>
      <Mt5EaSetupGuide
        open={showGuide}
        onClose={() => setShowGuide(false)}
        downloadUrl={eaDistribution.downloadUrl}
        checksumUrl={eaDistribution.checksumUrl}
        gatewayUrl={eaDistribution.gatewayUrl}
        webRequestOrigin={eaDistribution.webRequestOrigin}
        pairing={pairing}
        pairingLoading={pairingLoading}
        pairingFailed={pairingFailed}
        onGeneratePairingToken={createPairingToken}
      />
      <ExecutionAccountManagementDialog
        account={managedAccount}
        pairing={pairing}
        pairingFailed={pairingFailed}
        pairingLoading={pairingLoading}
        onClose={() => setManagedAccount(null)}
        onGeneratePairingToken={createPairingToken}
      />
    </aside>
  );
}

function CopyRoutingPanel() {
  const accounts = useAtomValue(executionAccountsAtom);
  const selectedId = useAtomValue(selectedExecutionAccountIdAtom);
  const canonicalSymbol = useAtomValue(symbolAtom);
  const targets = useAtomValue(copyTargetsAtom);
  const setTarget = useSetAtom(setCopyTargetAtom);
  const source = accounts.find((account) => account.id === selectedId);
  const available = accounts.filter((account) => account.id !== selectedId);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h2 className="text-sm font-bold text-ink">Copy routing</h2>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-ink-muted">
              Select targets and allocation rules. Every target is validated
              independently by Rust; one rejected account does not hide fills on
              the others.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-terminal-border bg-terminal-panel-2 px-2.5 py-1.5 text-[10px] text-ink-muted">
            <Copy size={12} />
            {available.length} available
          </span>
        </div>

        {source && (
          <div className="mt-4 rounded-xl border border-brand/25 bg-brand/5 p-3">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(180px,280px)] items-center gap-3">
              <div>
                <strong className="block text-[11px] text-ink">
                  Source symbol · {source.label}
                </strong>
                <span className="mt-0.5 block text-[9px] text-ink-faint">
                  Map chart symbol {canonicalSymbol} to the broker symbol
                  reported by this account.
                </span>
              </div>
              <SymbolMappingSelector
                account={source}
                canonicalSymbol={canonicalSymbol}
              />
            </div>
          </div>
        )}

        {available.length === 0 ? (
          <div className="mt-5 flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-terminal-border-strong bg-terminal-panel-2/35 px-6 text-center">
            <CircleOff size={22} className="text-ink-faint" />
            <strong className="mt-3 text-xs text-ink">
              No second execution account yet
            </strong>
            <span className="mt-1 max-w-md text-[10px] leading-4 text-ink-faint">
              Pair another terminal with the common MT5 EA or enable a
              production native venue adapter. Unwired venues are never exposed
              as tradable targets.
            </span>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {available.map((account) => {
              const target = targets[account.id] ?? {
                accountId: account.id,
                enabled: false,
                allocationMode: "sameQuantity" as const,
                multiplier: 1,
              };
              return (
                <div
                  key={account.id}
                  className="grid grid-cols-[minmax(0,1fr)_150px_112px] items-center gap-3 rounded-xl border border-terminal-border bg-terminal-panel-2/45 p-3"
                >
                  <label className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={target.enabled}
                      onChange={(event) =>
                        setTarget({
                          accountId: account.id,
                          enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <strong className="block truncate text-[11px] text-ink">
                        {account.label}
                      </strong>
                      <span className="block truncate text-[9px] text-ink-faint">
                        {account.brokerCode} · {account.externalAccountRef}
                      </span>
                    </span>
                  </label>
                  <select
                    aria-label={`Allocation for ${account.label}`}
                    value={target.allocationMode}
                    onChange={(event) =>
                      setTarget({
                        accountId: account.id,
                        allocationMode: event.target
                          .value as typeof target.allocationMode,
                      })
                    }
                    className="h-8 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[10px] text-ink outline-none focus:border-brand"
                  >
                    <option value="sameQuantity">Same quantity</option>
                    <option value="multiplier">Multiplier</option>
                    <option value="equityProportional">Equity proportional</option>
                    <option value="riskPercent">Risk percent</option>
                  </select>
                  <label className="flex items-center gap-2 text-[9px] text-ink-faint">
                    {target.allocationMode === "riskPercent" ? "Risk %" : "Mult."}
                    <input
                      inputMode="decimal"
                      value={
                        target.allocationMode === "riskPercent"
                          ? (target.riskBasisPoints ?? 50) / 100
                          : target.multiplier
                      }
                      onChange={(event) =>
                        target.allocationMode === "riskPercent"
                          ? setTarget({
                              accountId: account.id,
                              riskBasisPoints: Math.max(
                                1,
                                Math.min(
                                  10_000,
                                  Math.round(
                                    Number(event.target.value) * 100,
                                  ),
                                ),
                              ),
                            })
                          : setTarget({
                              accountId: account.id,
                              multiplier: Number(event.target.value),
                            })
                      }
                      className="h-8 min-w-0 flex-1 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[10px] text-ink outline-none focus:border-brand"
                    />
                  </label>
                  <div className="col-span-3 grid grid-cols-[minmax(0,1fr)_minmax(180px,280px)] items-center gap-3 border-t border-terminal-border pt-2">
                    <span className="text-[9px] text-ink-faint">
                      {canonicalSymbol} broker symbol
                    </span>
                    <SymbolMappingSelector
                      account={account}
                      canonicalSymbol={canonicalSymbol}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SymbolMappingSelector({
  account,
  canonicalSymbol,
}: {
  account: ExecutionAccountSummary;
  canonicalSymbol: string;
}) {
  const [registry, setRegistry] =
    useState<ExecutionAccountInstrumentsWire | null>(null);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void getExecutionInstruments(account.id)
      .then((next) => {
        if (cancelled) return;
        setRegistry(next);
        const mapping = next.mappings.find(
          (item) =>
            item.canonicalSymbol.toUpperCase() === canonicalSymbol.toUpperCase(),
        );
        setValue(mapping?.venueSymbol ?? "");
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [account.id, canonicalSymbol]);

  const save = async (venueSymbol: string) => {
    setValue(venueSymbol);
    if (!venueSymbol) return;
    setStatus("saving");
    try {
      const mapping = await upsertExecutionSymbolMapping({
        accountId: account.id,
        canonicalSymbol,
        venueSymbol,
      });
      setRegistry((current) =>
        current
          ? {
              ...current,
              mappings: [
                ...current.mappings.filter(
                  (item) =>
                    item.canonicalSymbol.toUpperCase() !==
                    canonicalSymbol.toUpperCase(),
                ),
                mapping,
              ],
            }
          : current,
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  };

  return (
    <label className="flex min-w-0 items-center gap-2">
      <select
        aria-label={`${canonicalSymbol} broker symbol for ${account.label}`}
        value={value}
        disabled={status === "loading" || status === "saving"}
        onChange={(event) => void save(event.target.value)}
        className="h-8 min-w-0 flex-1 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[10px] text-ink outline-none focus:border-brand disabled:opacity-60"
      >
        <option value="">
          {status === "loading"
            ? "Loading symbols…"
            : status === "error"
              ? "Retry by reopening this tab"
              : "Select broker symbol"}
        </option>
        {(registry?.instruments ?? []).map((instrument) => (
          <option
            key={instrument.venueSymbol}
            value={instrument.venueSymbol}
            disabled={!instrument.tradeAllowed}
          >
            {instrument.venueSymbol}
            {instrument.tradeAllowed ? "" : " (not tradable)"}
          </option>
        ))}
      </select>
      <span
        className={cn(
          "w-10 shrink-0 text-right text-[8px] uppercase",
          status === "error" ? "text-bear" : "text-ink-faint",
        )}
      >
        {status === "saving" ? "saving" : status === "error" ? "error" : ""}
      </span>
    </label>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 tabular text-xs font-semibold text-ink",
          tone === "positive" && "text-bull",
          tone === "negative" && "text-bear",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function WorkspaceTabButton({
  active,
  icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "relative flex h-9 items-center gap-1.5 px-3 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
        active ? "text-ink" : "text-ink-muted hover:text-ink",
      )}
    >
      {icon}
      {children}
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-brand" />
      )}
    </button>
  );
}
