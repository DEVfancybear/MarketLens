"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Check,
  CircleOff,
  Clipboard,
  Clock3,
  Copy,
  Download,
  FileCheck2,
  GripVertical,
  Gauge,
  KeyRound,
  LoaderCircle,
  Plus,
  Radio,
  Server,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { OrderTicket } from "./OrderTicket";
import { PositionsTable } from "./PositionsTable";
import { ExecutionModeSwitch } from "./ExecutionModeSwitch";
import { ExecutionConnectionStatus } from "./ExecutionConnectionStatus";
import { PropRiskCompactStatus } from "./PropRiskGuardCard";
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
  copyRoutesAtom,
  copyRoutesHydratedAtom,
  executionAccountLayoutAtom,
  executionAccountLayoutPendingAtom,
  executionAccountsAtom,
  selectedExecutionAccountAtom,
  selectedExecutionAccountIdAtom,
  applyCopyRoutesAtom,
  setCopyTargetAtom,
} from "@/store/executionRegistryStore";
import { cn } from "@/utils/cn";
import { fmtMoney } from "@/utils/format";
import type {
  CopyRoutePreview,
  CopyTargetDraft,
  ExecutionAccountSummary,
} from "@/types/execution";
import {
  getExecutionInstruments,
  getExecutionAccountLayout,
  updateExecutionAccountLayout,
  upsertExecutionSymbolMapping,
  type ExecutionAccountInstrumentsWire,
} from "@/services/api/resources/executionApi";
import { symbolAtom } from "@/store/chartStore";
import { executionEaDistribution } from "@/services/execution/eaDistribution";
import { eaUpgradeLabel } from "@/services/execution/eaCompatibility";
import {
  copyTargetAvailability,
  previewCopyRoutes,
  type CopyTargetAvailability,
} from "@/services/execution/copyRouting";
import { useExecutionPairingToken } from "@/hooks/useExecutionPairingToken";
import {
  loadTradeCopierPreferences,
  saveTradeCopierPreferences,
} from "@/services/execution/copierPreferences";
import {
  executionAccountDropEdge,
  mergeExecutionAccountLayout,
  moveExecutionAccountItem,
  shouldActivateExecutionAccountDrag,
  type AccountDropEdge,
} from "@/services/execution/accountLayout";
import { pushToastAtom } from "@/store/toastStore";
import { ContinuousCopierPanel } from "./ContinuousCopierPanel";
import { CopierGuidePanel } from "./CopierGuidePanel";
import { useI18n } from "@/hooks/useI18n";
import type { Translate, TranslationKey } from "@/i18n/localization";

type WorkspaceTab = "positions" | "copy" | "activity";

export function TradeWorkspace() {
  const [tab, setTab] = useState<WorkspaceTab>("positions");
  const equity = useAtomValue(equityAtom);
  const startingEquity = useAtomValue(startingEquityAtom);
  const positions = useAtomValue(positionsAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Account = useAtomValue(mt5AccountAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const selectedExecutionAccount = useAtomValue(selectedExecutionAccountAtom);

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
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {executionMode === "mt5" ? (
              <>
                <PropRiskCompactStatus account={selectedExecutionAccount} />
                <ExecutionConnectionStatus />
              </>
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
            MT5 Copier
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
              <Mt5CommandLog variant="activity" />
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
  const [accountLayout, setAccountLayout] = useAtom(executionAccountLayoutAtom);
  const [layoutPending, setLayoutPending] = useAtom(
    executionAccountLayoutPendingAtom,
  );
  const pushToast = useSetAtom(pushToastAtom);
  const dragSession = useRef<{
    pointerId: number;
    sourceId: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const suppressNextAccountClickRef = useRef(false);
  const dropTargetRef = useRef<{
    id: string;
    edge: AccountDropEdge;
  } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    edge: AccountDropEdge;
  } | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
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
  const accounts = mergeExecutionAccountLayout(
    [simulator, ...gatewayAccounts],
    accountLayout.itemIds,
  );

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    },
    [],
  );

  const saveLayout = async (itemIds: string[]) => {
    if (layoutPending) return;
    const previous = accountLayout;
    setLayoutPending(true);
    setAccountLayout({ itemIds, revision: previous.revision });
    try {
      const saved = await updateExecutionAccountLayout(
        itemIds,
        previous.revision,
      );
      setLayoutPending(false);
      setAccountLayout(saved);
      setReorderAnnouncement("Account order saved.");
    } catch {
      try {
        const latest = await getExecutionAccountLayout();
        setLayoutPending(false);
        setAccountLayout(latest);
      } catch {
        setLayoutPending(false);
        setAccountLayout(previous);
      }
      pushToast({
        title: "Account order was not saved",
        message:
          "The order changed elsewhere or the execution service is unavailable. The latest server order was restored.",
        variant: "error",
      });
    }
  };

  const resolveDropTarget = (
    clientX: number,
    clientY: number,
    sourceId: string,
  ) => {
    const element = document
      .elementFromPoint(clientX, clientY)
      ?.closest<HTMLElement>("[data-execution-account-id]");
    const targetId = element?.dataset.executionAccountId;
    if (!element || !targetId || targetId === sourceId) return null;
    const bounds = element.getBoundingClientRect();
    return {
      id: targetId,
      edge: executionAccountDropEdge(clientY, bounds.top, bounds.height),
    };
  };

  const finishDrag = (
    pointerId: number,
    commit: boolean,
    finalPoint?: { x: number; y: number },
  ) => {
    const session = dragSession.current;
    if (!session || session.pointerId !== pointerId) return;
    const finalTarget =
      commit && finalPoint
        ? resolveDropTarget(finalPoint.x, finalPoint.y, session.sourceId) ??
          dropTargetRef.current
        : dropTargetRef.current;
    if (commit && session.active && finalTarget) {
      const next = moveExecutionAccountItem(
        accounts.map((account) => account.id),
        session.sourceId,
        finalTarget.id,
        finalTarget.edge,
      );
      void saveLayout(next);
    }
    if (session.active) {
      suppressNextAccountClickRef.current = true;
      window.setTimeout(() => {
        suppressNextAccountClickRef.current = false;
      }, 0);
    }
    const cleanup = dragCleanupRef.current;
    dragCleanupRef.current = null;
    cleanup?.();
    dragSession.current = null;
    dropTargetRef.current = null;
    setDraggedId(null);
    setDragOffsetY(0);
    setDropTarget(null);
  };

  const startAccountDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    accountId: string,
  ) => {
    if (layoutPending || event.button !== 0) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("[data-execution-account-no-drag]")
    ) {
      return;
    }

    dragCleanupRef.current?.();
    dragSession.current = {
      pointerId: event.pointerId,
      sourceId: accountId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const session = dragSession.current;
      if (!session || session.pointerId !== pointerEvent.pointerId) return;
      if (
        !session.active &&
        !shouldActivateExecutionAccountDrag(
          session.startX,
          session.startY,
          pointerEvent.clientX,
          pointerEvent.clientY,
        )
      ) {
        return;
      }
      if (!session.active) {
        session.active = true;
        setDraggedId(session.sourceId);
      }
      pointerEvent.preventDefault();
      setDragOffsetY(pointerEvent.clientY - session.startY);
      const nextTarget = resolveDropTarget(
        pointerEvent.clientX,
        pointerEvent.clientY,
        session.sourceId,
      );
      dropTargetRef.current = nextTarget;
      setDropTarget(nextTarget);
    };
    const onPointerUp = (pointerEvent: PointerEvent) => {
      finishDrag(pointerEvent.pointerId, true, {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY,
      });
    };
    const onPointerCancel = (pointerEvent: PointerEvent) => {
      finishDrag(pointerEvent.pointerId, false);
    };
    const onWindowBlur = () => {
      const session = dragSession.current;
      if (session) finishDrag(session.pointerId, false);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", onWindowBlur);
  };

  const keyboardMove = (accountId: string, direction: -1 | 1) => {
    if (layoutPending) return;
    const itemIds = accounts.map((account) => account.id);
    const index = itemIds.indexOf(accountId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= itemIds.length) return;
    const next = moveExecutionAccountItem(
      itemIds,
      accountId,
      itemIds[targetIndex],
      direction < 0 ? "before" : "after",
    );
    const account = accounts[index];
    setReorderAnnouncement(
      `${account.label} moved ${direction < 0 ? "up" : "down"}.`,
    );
    void saveLayout(next);
  };

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
            {layoutPending && " · syncing order…"}
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
      <span className="sr-only" aria-live="polite">
        {reorderAnnouncement}
      </span>
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
                  Version {eaDistribution.releaseVersion} · all MT5 brokers
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
          const dragging = draggedId === account.id;
          return (
            <div
              key={account.id}
              data-execution-account-id={account.id}
              onPointerDown={(event) => startAccountDrag(event, account.id)}
              style={
                dragging
                  ? {
                      transform: `translate3d(0, ${dragOffsetY}px, 0)`,
                    }
                  : undefined
              }
              className={cn(
                "relative w-full select-none rounded-xl border transition-[border-color,background-color,opacity,transform]",
                active
                  ? "border-brand/50 bg-brand/10"
                  : "border-terminal-border bg-terminal-panel-2/45 hover:border-terminal-border-strong hover:bg-terminal-hover",
                dragging &&
                  "pointer-events-none z-30 cursor-grabbing border-brand/70 bg-terminal-panel shadow-[0_14px_32px_rgb(0_0_0/0.42),0_0_0_1px_rgb(var(--accent-rgb)/0.28)] transition-none",
                dropTarget?.id === account.id &&
                  dropTarget.edge === "before" &&
                  "before:absolute before:-top-1 before:left-2 before:right-2 before:z-10 before:h-0.5 before:rounded-full before:bg-brand",
                dropTarget?.id === account.id &&
                  dropTarget.edge === "after" &&
                  "after:absolute after:-bottom-1 after:left-2 after:right-2 after:z-10 after:h-0.5 after:rounded-full after:bg-brand",
              )}
            >
              <button
                type="button"
                disabled={layoutPending}
                aria-label={`Reorder ${account.label}. Drag or use Arrow Up and Arrow Down.`}
                title="Drag to reorder · Arrow Up/Down"
                onKeyDown={(event) => {
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  keyboardMove(account.id, event.key === "ArrowUp" ? -1 : 1);
                }}
                className="absolute left-1 top-1/2 z-10 flex h-8 w-6 -translate-y-1/2 touch-none cursor-grab items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-terminal-hover hover:text-ink active:cursor-grabbing disabled:cursor-wait disabled:opacity-40 focus-ring"
              >
                <GripVertical size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (suppressNextAccountClickRef.current) return;
                  select(account);
                }}
                aria-pressed={active}
                className={cn(
                  "w-full py-3 pl-8 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60",
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
                  {account.statusReason === "ea_update_required" && (
                    <span className="mt-1 block text-[9px] font-semibold text-bear">
                      {eaUpgradeLabel(account)}
                    </span>
                  )}
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
                  data-execution-account-no-drag
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

export function CopyRoutingPanel() {
  const { t } = useI18n();
  const [mode, setMode] = useState<"continuous" | "oneShot" | "guide">(
    "continuous",
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = [
    { id: "continuous" as const, label: t("copier.mode.continuous") },
    { id: "oneShot" as const, label: t("copier.mode.oneShot") },
    { id: "guide" as const, label: t("copier.mode.guide") },
  ];

  const selectAdjacentTab = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const next = tabs[nextIndex]!;
    setMode(next.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const openModeFromGuide = (nextMode: "continuous" | "oneShot") => {
    const nextIndex = tabs.findIndex((tab) => tab.id === nextMode);
    setMode(nextMode);
    requestAnimationFrame(() => tabRefs.current[nextIndex]?.focus());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-terminal-border bg-terminal-panel-2/30 px-3"
        role="tablist"
        aria-label={t("copier.mode.aria")}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            id={`copier-tab-${tab.id}`}
            type="button"
            role="tab"
            tabIndex={mode === tab.id ? 0 : -1}
            aria-selected={mode === tab.id}
            aria-controls={`copier-panel-${tab.id}`}
            onClick={() => setMode(tab.id)}
            onKeyDown={(event) => selectAdjacentTab(event, index)}
            className={cn(
              "min-h-9 shrink-0 rounded-lg px-3 text-[10px] font-semibold focus-ring",
              mode === tab.id
                ? "bg-brand/10 text-brand"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`copier-panel-${mode}`}
        role="tabpanel"
        aria-labelledby={`copier-tab-${mode}`}
        tabIndex={0}
        className="min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/35"
      >
        {mode === "continuous" ? (
          <ContinuousCopierPanel />
        ) : mode === "oneShot" ? (
          <OneShotCopyRoutingPanel />
        ) : (
          <CopierGuidePanel onOpenMode={openModeFromGuide} />
        )}
      </div>
    </div>
  );
}

function OneShotCopyRoutingPanel() {
  const { t } = useI18n();
  const accounts = useAtomValue(executionAccountsAtom);
  const selectedId = useAtomValue(selectedExecutionAccountIdAtom);
  const canonicalSymbol = useAtomValue(symbolAtom);
  const targets = useAtomValue(copyTargetsAtom);
  const routes = useAtomValue(copyRoutesAtom);
  const routesHydrated = useAtomValue(copyRoutesHydratedAtom);
  const setTarget = useSetAtom(setCopyTargetAtom);
  const applyRoutes = useSetAtom(applyCopyRoutesAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const [persistenceStatus, setPersistenceStatus] = useState<
    "loading" | "ready" | "saving" | "saved" | "error"
  >("loading");
  const [persistedSignature, setPersistedSignature] = useState<string | null>(
    null,
  );
  const [loadAttempt, setLoadAttempt] = useState(0);
  const source = accounts.find((account) => account.id === selectedId);
  const available = accounts.filter((account) => account.id !== selectedId);
  const eligibleTargetCount = available.filter(
    (account) => copyTargetAvailability(account).eligible,
  ).length;
  const enabledTargetCount = available.filter(
    (account) => targets[account.id]?.enabled,
  ).length;
  const routePreviews = useMemo(
    () =>
      previewCopyRoutes({
        sourceAccountId: selectedId ?? "",
        sourceQuantity: 1,
        sourceEquity: source?.equity,
        accounts,
        targets: available.map(
          (account) =>
            targets[account.id] ?? {
              accountId: account.id,
              enabled: false,
              allocationMode: "sameQuantity" as const,
              multiplier: 1,
            },
        ),
      }),
    [accounts, available, selectedId, source?.equity, targets],
  );
  const previewByAccount = useMemo(
    () => new Map(routePreviews.map((preview) => [preview.accountId, preview])),
    [routePreviews],
  );
  const routesSignature = useMemo(() => JSON.stringify(routes), [routes]);
  const hasInvalidEnabledTarget = available.some((account) => {
    const target = targets[account.id];
    return Boolean(target?.enabled && copyTargetConfigError(target, t));
  });
  const routesDirty =
    routesHydrated && persistedSignature !== null && routesSignature !== persistedSignature;

  useEffect(() => {
    if (routesHydrated) return;
    let cancelled = false;
    setPersistenceStatus("loading");
    void loadTradeCopierPreferences()
      .then((nextRoutes) => {
        if (cancelled) return;
        applyRoutes(nextRoutes);
        setPersistedSignature(JSON.stringify(nextRoutes));
        setPersistenceStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setPersistenceStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [applyRoutes, loadAttempt, routesHydrated]);

  useEffect(() => {
    if (!routesHydrated) return;
    setPersistedSignature((current) => current ?? routesSignature);
    setPersistenceStatus((current) =>
      current === "loading" ? "ready" : current,
    );
  }, [routesHydrated, routesSignature]);

  const saveRoutes = async () => {
    if (!routesHydrated || hasInvalidEnabledTarget) return;
    setPersistenceStatus("saving");
    try {
      await saveTradeCopierPreferences(routes);
      setPersistedSignature(routesSignature);
      setPersistenceStatus("saved");
      pushToast({
        title: t("copier.oneShot.toast.saved"),
        message: t("copier.oneShot.toast.savedMessage"),
        variant: "success",
      });
    } catch {
      setPersistenceStatus("error");
      pushToast({
        title: t("copier.oneShot.toast.failed"),
        message: t("copier.oneShot.toast.failedMessage"),
        variant: "error",
      });
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-ink">
                {t("copier.oneShot.title")}
              </h2>
              <span className="rounded-md border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-brand">
                {t("copier.oneShot.badge")}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-[11px] leading-5 text-ink-muted">
              {t("copier.oneShot.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-terminal-border bg-terminal-panel-2 px-2.5 py-1.5 text-[10px] text-ink-muted">
              <Copy size={12} />
              {t("copier.oneShot.summary", {
                enabled: enabledTargetCount,
                eligible: eligibleTargetCount,
              })}
            </span>
            <button
              type="button"
              onClick={() => void saveRoutes()}
              disabled={
                !routesHydrated ||
                persistenceStatus === "saving" ||
                !routesDirty ||
                hasInvalidEnabledTarget
              }
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {persistenceStatus === "loading" || persistenceStatus === "saving" ? (
                <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
              ) : (
                <Save size={12} aria-hidden="true" />
              )}
              {persistenceStatus === "saving"
                ? t("copier.oneShot.saving")
                : persistenceStatus === "saved" && !routesDirty
                  ? t("copier.oneShot.saved")
                  : t("copier.oneShot.save")}
            </button>
          </div>
        </div>

        {persistenceStatus === "error" && (
          <p role="alert" className="mt-2 text-[9px] leading-4 text-bear">
            {routesHydrated ? (
              t("copier.oneShot.saveFailed")
            ) : (
              <>
                {t("copier.oneShot.savedUnavailable")} {" "}
                <button
                  type="button"
                  onClick={() => setLoadAttempt((attempt) => attempt + 1)}
                  className="font-semibold underline underline-offset-2"
                >
                  {t("copier.oneShot.retry")}
                </button>
              </>
            )}
          </p>
        )}
        {hasInvalidEnabledTarget && (
          <p role="alert" className="mt-2 text-[9px] leading-4 text-bear">
            {t("copier.oneShot.invalidSizing")}
          </p>
        )}

        <div
          role="note"
          className="mt-4 flex gap-2.5 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3"
        >
          <AlertTriangle
            size={15}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-sky-400"
          />
          <div>
            <strong className="block text-[10px] text-ink">
              {t("copier.oneShot.routingActive")}
            </strong>
            <p className="mt-0.5 text-[9px] leading-4 text-ink-muted">
              {t("copier.oneShot.routingDescription")}
            </p>
          </div>
        </div>

        {source && (
          <div className="mt-4 rounded-xl border border-brand/25 bg-brand/5 p-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(180px,280px)] lg:items-center">
              <div>
                <strong className="block text-[11px] text-ink">
                  {t("copier.oneShot.sourceSymbol", { account: source.label })}
                </strong>
                <span className="mt-0.5 block text-[9px] text-ink-faint">
                  {t("copier.oneShot.sourceSymbolDescription", {
                    symbol: canonicalSymbol,
                  })}
                </span>
              </div>
              <SymbolMappingSelector
                account={source}
                canonicalSymbol={canonicalSymbol}
              />
            </div>
          </div>
        )}

        <div
          role="note"
          className="mt-3 flex gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"
        >
          <Clock3
            size={15}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-amber-400"
          />
          <div>
            <strong className="block text-[10px] text-ink">
              {t("copier.oneShot.offlineTitle")}
            </strong>
            <p className="mt-0.5 text-[9px] leading-4 text-ink-muted">
              {t("copier.oneShot.offlineDescription")}
            </p>
          </div>
        </div>

        {available.length === 0 ? (
          <div className="mt-5 flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-terminal-border-strong bg-terminal-panel-2/35 px-6 text-center">
            <CircleOff size={22} className="text-ink-faint" />
            <strong className="mt-3 text-xs text-ink">
              {t("copier.oneShot.noAccount")}
            </strong>
            <span className="mt-1 max-w-md text-[10px] leading-4 text-ink-faint">
              {t("copier.oneShot.noAccountDescription")}
            </span>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {available.map((account) => {
              const availability = copyTargetAvailability(account);
              const availabilityText = localizeCopyAvailability(t, availability);
              const target = targets[account.id] ?? {
                accountId: account.id,
                enabled: false,
                allocationMode: "sameQuantity" as const,
                multiplier: 1,
              };
              const configError = copyTargetConfigError(target, t);
              const preview = previewByAccount.get(account.id);
              return (
                <div
                  key={account.id}
                  className="grid grid-cols-1 items-center gap-3 rounded-xl border border-terminal-border bg-terminal-panel-2/45 p-3 lg:grid-cols-[minmax(150px,1fr)_145px_112px_112px]"
                >
                  <label className="flex min-h-11 min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={target.enabled && availability.eligible}
                      disabled={!availability.eligible}
                      aria-describedby={`copy-target-status-${account.id}`}
                      onChange={(event) =>
                        setTarget({
                          accountId: account.id,
                          enabled: event.target.checked,
                        })
                      }
                      className="h-4 w-4 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
                    />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <strong className="block truncate text-[11px] text-ink">
                          {account.label}
                        </strong>
                        <span
                          aria-live="polite"
                          className={cn(
                            "shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide",
                            availability.mode === "ready"
                              ? "bg-bull/10 text-bull"
                              : availability.mode === "waiting"
                                ? "bg-amber-500/10 text-amber-400"
                                : "bg-bear/10 text-bear",
                          )}
                        >
                          {availabilityText.label}
                        </span>
                      </span>
                      <span className="block truncate text-[9px] text-ink-faint">
                        {account.brokerCode} · {account.externalAccountRef}
                      </span>
                    </span>
                  </label>
                  <select
                    aria-label={t("copier.oneShot.allocationAria", {
                      account: account.label,
                    })}
                    value={target.allocationMode}
                    onChange={(event) => {
                      const allocationMode = event.target
                        .value as typeof target.allocationMode;
                      setTarget({
                        accountId: account.id,
                        allocationMode,
                        ...(allocationMode === "fixedQuantity" &&
                        !(target.fixedQuantity && target.fixedQuantity > 0)
                          ? { fixedQuantity: 0.1 }
                          : {}),
                      });
                    }}
                    className="h-11 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] text-ink outline-none focus:border-brand"
                  >
                    <option value="sameQuantity">{t("copier.allocation.same")}</option>
                    <option value="fixedQuantity">{t("copier.allocation.fixed")}</option>
                    <option value="multiplier">{t("copier.allocation.multiplier")}</option>
                    <option value="equityProportional">{t("copier.allocation.equity")}</option>
                    <option value="riskPercent">{t("copier.allocation.risk")}</option>
                  </select>
                  {target.allocationMode === "sameQuantity" ? (
                    <div className="flex h-11 items-center rounded-lg border border-terminal-border bg-terminal-panel px-2 text-[9px] text-ink-faint">
                      {t("copier.allocation.usesSource")}
                    </div>
                  ) : (
                    <label className="grid gap-1 text-[9px] text-ink-faint">
                      <span>
                        {target.allocationMode === "riskPercent"
                          ? t("copier.allocation.riskShort")
                          : target.allocationMode === "fixedQuantity"
                            ? t("copier.allocation.fixed")
                            : t("copier.allocation.multiplier")}
                      </span>
                      <input
                        aria-label={t("copier.oneShot.valueAria", {
                          mode: allocationModeLabel(t, target.allocationMode),
                          account: account.label,
                        })}
                        inputMode="decimal"
                        min={target.allocationMode === "riskPercent" ? 0.01 : 0.00000001}
                        max={target.allocationMode === "riskPercent" ? 100 : undefined}
                        step={target.allocationMode === "riskPercent" ? 0.01 : 0.01}
                        value={
                          target.allocationMode === "riskPercent"
                            ? (target.riskBasisPoints ?? 50) / 100
                            : target.allocationMode === "fixedQuantity"
                              ? (target.fixedQuantity ?? 0.1)
                              : target.multiplier
                        }
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (target.allocationMode === "riskPercent") {
                            setTarget({
                              accountId: account.id,
                              riskBasisPoints: Math.max(
                                1,
                                Math.min(10_000, Math.round(value * 100)),
                              ),
                            });
                          } else if (target.allocationMode === "fixedQuantity") {
                            setTarget({
                              accountId: account.id,
                              fixedQuantity: value,
                            });
                          } else {
                            setTarget({
                              accountId: account.id,
                              multiplier: value,
                            });
                          }
                        }}
                        className="h-11 min-w-0 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-base text-ink outline-none focus:border-brand lg:text-[11px]"
                      />
                    </label>
                  )}
                  <label className="grid gap-1 text-[9px] text-ink-faint">
                    <span>{t("copier.allocation.maxLotShort")}</span>
                    <input
                      aria-label={t("copier.oneShot.maxAria", {
                        account: account.label,
                      })}
                      inputMode="decimal"
                      min="0.00000001"
                      step="0.01"
                      placeholder={t("copier.allocation.brokerMax")}
                      value={target.maxQuantity ?? ""}
                      onChange={(event) =>
                        setTarget({
                          accountId: account.id,
                          maxQuantity: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                      className="h-11 min-w-0 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-base text-ink outline-none placeholder:text-ink-faint focus:border-brand lg:text-[11px]"
                    />
                  </label>
                  <p
                    id={`copy-target-status-${account.id}`}
                    className={cn(
                      "flex items-start gap-1.5 text-[9px] leading-4 lg:col-span-4",
                      availability.mode === "waiting"
                        ? "text-amber-300"
                        : availability.mode === "blocked"
                          ? "text-bear"
                          : "text-ink-faint",
                    )}
                  >
                    {availability.mode === "waiting" && (
                      <Clock3
                        size={11}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0"
                      />
                    )}
                    {availabilityText.detail}
                  </p>
                  <div className="grid gap-3 border-t border-terminal-border pt-2 lg:col-span-4 lg:grid-cols-[minmax(0,1fr)_minmax(180px,280px)] lg:items-center">
                    <TargetRoutePreview
                      target={target}
                      preview={preview}
                      error={configError}
                    />
                    <div className="grid gap-1">
                      <span className="text-[9px] text-ink-faint">
                        {t("copier.oneShot.brokerSymbol", {
                          symbol: canonicalSymbol,
                        })}
                      </span>
                      <SymbolMappingSelector
                        account={account}
                        canonicalSymbol={canonicalSymbol}
                      />
                    </div>
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

function TargetRoutePreview({
  target,
  preview,
  error,
}: {
  target: CopyTargetDraft;
  preview?: CopyRoutePreview;
  error: string | null;
}) {
  const { t } = useI18n();
  let detail = t("copier.oneShot.routeDisabled");
  let tone = "text-ink-faint";
  if (target.enabled) {
    if (error) {
      detail = error;
      tone = "text-bear";
    } else if (target.allocationMode === "riskPercent") {
      detail = t("copier.oneShot.rustSizing");
      tone = "text-brand";
    } else if (preview?.status === "ready") {
      detail = t("copier.oneShot.previewValue", {
        quantity: formatLot(preview.quantity),
      });
      tone = "text-bull";
    } else if (preview?.status === "waiting") {
      detail = t("copier.oneShot.previewReady");
      tone = "text-amber-300";
    } else if (preview?.status === "blocked") {
      detail = t(copyPreviewReasonKey(preview.reason));
      tone = "text-bear";
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
        <Gauge size={14} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <strong className="block text-[9px] uppercase tracking-wide text-ink-faint">
          {t("copier.oneShot.preview")}
        </strong>
        <span className={cn("mt-0.5 block text-[10px] font-semibold", tone)}>
          {detail}
        </span>
      </span>
    </div>
  );
}

function copyTargetConfigError(
  target: CopyTargetDraft,
  t: Translate,
): string | null {
  if (
    target.allocationMode === "fixedQuantity" &&
    !isPositiveNumber(target.fixedQuantity)
  ) {
    return t("copier.oneShot.error.fixed");
  }
  if (
    (target.allocationMode === "multiplier" ||
      target.allocationMode === "equityProportional") &&
    !isPositiveNumber(target.multiplier)
  ) {
    return t("copier.oneShot.error.multiplier");
  }
  if (
    target.allocationMode === "riskPercent" &&
    (!Number.isInteger(target.riskBasisPoints) ||
      (target.riskBasisPoints ?? 0) < 1 ||
      (target.riskBasisPoints ?? 0) > 10_000)
  ) {
    return t("copier.oneShot.error.risk");
  }
  if (target.maxQuantity != null && !isPositiveNumber(target.maxQuantity)) {
    return t("copier.oneShot.error.maxLot");
  }
  return null;
}

function allocationModeLabel(
  t: Translate,
  mode: CopyTargetDraft["allocationMode"],
): string {
  const keys: Record<CopyTargetDraft["allocationMode"], TranslationKey> = {
    sameQuantity: "copier.allocation.same",
    fixedQuantity: "copier.allocation.fixed",
    multiplier: "copier.allocation.multiplier",
    equityProportional: "copier.allocation.equity",
    riskPercent: "copier.allocation.risk",
  };
  return t(keys[mode]);
}

function localizeCopyAvailability(
  t: Translate,
  availability: CopyTargetAvailability,
): Pick<CopyTargetAvailability, "label" | "detail"> {
  const keys: Record<string, [TranslationKey, TranslationKey]> = {
    Unavailable: [
      "copier.availability.unavailable",
      "copier.availability.unavailableDescription",
    ],
    Ready: [
      "copier.availability.ready",
      "copier.availability.readyDescription",
    ],
    "Offline · waits 5 min": [
      "copier.availability.waiting",
      "copier.availability.waitingDescription",
    ],
    "EA update required": [
      "copier.availability.update",
      "copier.availability.updateDescription",
    ],
    "Trading disabled": [
      "copier.availability.tradingDisabled",
      "copier.availability.tradingDisabledDescription",
    ],
    Disabled: [
      "copier.availability.disabled",
      "copier.availability.notReadyDescription",
    ],
    "Not ready": [
      "copier.availability.notReady",
      "copier.availability.notReadyDescription",
    ],
  };
  const pair = keys[availability.label];
  return pair
    ? { label: t(pair[0]), detail: t(pair[1]) }
    : { label: availability.label, detail: availability.detail };
}

function copyPreviewReasonKey(
  reason: Extract<CopyRoutePreview, { status: "blocked" }>["reason"],
): TranslationKey {
  const keys: Record<
    Extract<CopyRoutePreview, { status: "blocked" }>["reason"],
    TranslationKey
  > = {
    TARGET_DISABLED: "copier.oneShot.reason.targetDisabled",
    TARGET_NOT_FOUND: "copier.oneShot.reason.targetNotFound",
    TARGET_NOT_READY: "copier.oneShot.reason.targetNotReady",
    TARGET_CANNOT_TRADE: "copier.oneShot.reason.targetCannotTrade",
    SOURCE_EQUITY_REQUIRED: "copier.oneShot.reason.sourceEquity",
    TARGET_EQUITY_REQUIRED: "copier.oneShot.reason.targetEquity",
    INVALID_QUANTITY: "copier.oneShot.reason.invalidQuantity",
  };
  return keys[reason];
}

function isPositiveNumber(value: number | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function formatLot(value: number): string {
  return value.toFixed(4).replace(/\.?0+$/, "");
}

function SymbolMappingSelector({
  account,
  canonicalSymbol,
}: {
  account: ExecutionAccountSummary;
  canonicalSymbol: string;
}) {
  const { t } = useI18n();
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
        aria-label={t("copier.symbol.aria", {
          symbol: canonicalSymbol,
          account: account.label,
        })}
        value={value}
        disabled={status === "loading" || status === "saving"}
        onChange={(event) => void save(event.target.value)}
        className="h-11 min-w-0 flex-1 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-base text-ink outline-none focus:border-brand disabled:opacity-60 lg:h-8 lg:text-[10px]"
      >
        <option value="">
          {status === "loading"
            ? t("copier.symbol.loading")
            : status === "error"
              ? t("copier.symbol.retry")
              : t("copier.symbol.select")}
        </option>
        {(registry?.instruments ?? []).map((instrument) => (
          <option
            key={instrument.venueSymbol}
            value={instrument.venueSymbol}
            disabled={!instrument.tradeAllowed}
          >
            {instrument.venueSymbol}
            {instrument.tradeAllowed
              ? ""
              : ` (${t("copier.symbol.notTradable")})`}
          </option>
        ))}
      </select>
      <span
        className={cn(
          "w-10 shrink-0 text-right text-[8px] uppercase",
          status === "error" ? "text-bear" : "text-ink-faint",
        )}
      >
        {status === "saving"
          ? t("copier.symbol.saving")
          : status === "error"
            ? t("copier.symbol.error")
            : ""}
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
