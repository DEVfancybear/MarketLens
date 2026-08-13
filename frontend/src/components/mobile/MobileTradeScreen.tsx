"use client";

import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Ban,
  BookOpen,
  Copy,
  Download,
  Pencil,
  RotateCcw,
  ServerCog,
  Settings2,
  X,
} from "lucide-react";
import { OrderTicket } from "@/components/trade/OrderTicket";
import { CopyRoutingPanel } from "@/components/trade/TradeWorkspace";
import { ExecutionModeSwitch } from "@/components/trade/ExecutionModeSwitch";
import { ExecutionConnectionStatus } from "@/components/trade/ExecutionConnectionStatus";
import { Mt5CommandLog } from "@/components/trade/Mt5CommandLog";
import { Mt5EaSetupGuide } from "@/components/trade/Mt5EaSetupGuide";
import { Mt5ManagedConnectionDialog } from "@/components/trade/Mt5ManagedConnectionDialog";
import { ExecutionAccountManagementDialog } from "@/components/trade/ExecutionAccountManagementDialog";
import {
  CopyTradeDialog,
  type CopyableMt5Trade,
} from "@/components/trade/CopyTradeDialog";
import {
  Mt5OrderEditorDialog,
  type EditableMt5Trade,
} from "@/components/trade/Mt5OrderEditorDialog";
import {
  cancelPendingAtom,
  closePositionAtom,
  equityAtom,
  positionsAtom,
  resetPersistedTradeAtom,
  startingEquityAtom,
} from "@/store/tradeStore";
import {
  cancelMt5OrderAtom,
  closeMt5PositionAtom,
  executionModeAtom,
  mt5AccountAtom,
  mt5PendingOrdersAtom,
  mt5PositionsAtom,
} from "@/store/mt5Store";
import { useReplayTrading } from "@/store/replayTradingClientStore";
import { useSimTradingPersistence } from "@/hooks/useSimTradingPersistence";
import { makeClientCommandId } from "@/services/execution/identifiers";
import { executionEaDistribution } from "@/services/execution/eaDistribution";
import { useExecutionPairingToken } from "@/hooks/useExecutionPairingToken";
import { useI18n } from "@/hooks/useI18n";
import {
  executionConnectorCapabilitiesAtom,
  selectedExecutionAccountAtom,
} from "@/store/executionRegistryStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { cn } from "@/utils/cn";
import type { Position } from "@/types";
import { usePlatformDialog, type PlatformConfirmOptions, type PlatformPromptOptions } from "@/components/ui/PlatformDialog";

type TradeTab = "ticket" | "positions" | "copier" | "activity";

export function MobileTradeScreen() {
  useSimTradingPersistence();
  const [tab, setTab] = useState<TradeTab>("ticket");
  const [showEaGuide, setShowEaGuide] = useState(false);
  const [showManagedConnect, setShowManagedConnect] = useState(false);
  const [showAccountManagement, setShowAccountManagement] = useState(false);
  const positions = useAtomValue(positionsAtom);
  const equity = useAtomValue(equityAtom);
  const starting = useAtomValue(startingEquityAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Account = useAtomValue(mt5AccountAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const mt5Pending = useAtomValue(mt5PendingOrdersAtom);
  const selectedExecutionAccount = useAtomValue(selectedExecutionAccountAtom);
  const connectorCapabilities = useAtomValue(
    executionConnectorCapabilitiesAtom,
  );
  const reset = useSetAtom(resetPersistedTradeAtom);
  const replay = useReplayTrading();
  const { requestPrompt, requestConfirm, dialog } = usePlatformDialog();
  const { t } = useI18n();
  const eaDistribution = executionEaDistribution();
  const {
    pairing,
    pairingFailed,
    pairingLoading,
    createPairingToken,
  } = useExecutionPairingToken();
  const replayMode = replay.active && executionMode === "simulator";
  const simulatorOpen = positions.filter((item) => item.status === "open" || item.status === "pending");
  const activeEquity = replayMode
    ? replay.account?.equity ?? equity
    : executionMode === "mt5"
      ? mt5Account?.equity ?? equity
      : equity;
  const openCount = replayMode
    ? replay.positions.filter((item) => Math.abs(item.netQuantity) > 1e-12).length + replay.orders.filter((item) => item.status === "pending" || item.status === "partially_filled").length
    : executionMode === "mt5"
      ? mt5Positions.length + mt5Pending.length
      : simulatorOpen.length;
  const pnl = replayMode
    ? replay.positions.reduce((sum, item) => sum + item.unrealizedPnl, 0)
    : executionMode === "mt5"
      ? mt5Positions.reduce((sum, item) => sum + item.profit, 0)
      : simulatorOpen.reduce((sum, item) => sum + item.unrealizedPnl, 0);
  const baseline = replayMode ? replay.account?.startingEquity ?? starting : starting;
  const returnPct = baseline ? ((activeEquity - baseline) / baseline) * 100 : 0;

  const resetAccount = () => {
    void requestConfirm({
      title: "Reset trading account?",
      description: "The active account balance, positions, and pending orders will be reset.",
      confirmLabel: "Reset account",
      tone: "danger",
    }).then((accepted) => {
      if (!accepted) return;
      if (replayMode) void replay.reset();
      else void reset();
    });
  };
  const exportReplayReport = async () => {
    const report = await replay.report();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `replay-report-${report.sessionId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <section className="mobile-screen mobile-trade-screen">
    <header className="mobile-screen-header"><div><small>EXECUTION</small><h1>Trade desk</h1></div><div className="mobile-equity"><small>Equity</small><strong>{fmtMoney(activeEquity)}</strong></div></header>
    <div className="mobile-execution-bar"><ExecutionModeSwitch />{executionMode === "mt5" && <ExecutionConnectionStatus />}</div>
    <div className="mobile-kpi-row mobile-kpi-row--trade"><div><small>Open positions</small><strong>{openCount}</strong></div><div><small>Open P/L</small><strong className={pnl >= 0 ? "text-bull" : "text-bear"}>{fmtMoney(pnl)}</strong></div><div><small>Return</small><strong className={returnPct >= 0 ? "text-bull" : "text-bear"}>{returnPct >= 0 ? "+" : ""}{returnPct.toFixed(2)}%</strong></div></div>
    <div className="mobile-trade-account-actions">
      {connectorCapabilities.mt5Managed && (
        <button type="button" onClick={() => setShowManagedConnect(true)}>
          <ServerCog size={17} />
          {t("execution.add.mobileManaged")}
        </button>
      )}
      <button type="button" onClick={() => setShowEaGuide(true)}>
        <BookOpen size={17} />
        {t("execution.add.mobileEa")}
      </button>
      {executionMode === "mt5" && selectedExecutionAccount && (
        <button
          type="button"
          onClick={() => setShowAccountManagement(true)}
        >
          <Settings2 size={17} />
          Quản lý account
        </button>
      )}
      {executionMode === "simulator" && <button type="button" onClick={resetAccount}><RotateCcw size={17} />Reset account</button>}
      {replayMode && <button type="button" onClick={() => void exportReplayReport()}><Download size={17} />Export replay report</button>}
    </div>
    <div className="mobile-segmented mobile-segmented--four" role="tablist" aria-label="Trade workspace">
      <MobileTradeTab active={tab === "ticket"} onClick={() => setTab("ticket")}>Ticket</MobileTradeTab>
      <MobileTradeTab active={tab === "positions"} onClick={() => setTab("positions")}>Positions</MobileTradeTab>
      <MobileTradeTab active={tab === "copier"} onClick={() => setTab("copier")}>Copier</MobileTradeTab>
      <MobileTradeTab active={tab === "activity"} onClick={() => setTab("activity")}>Activity</MobileTradeTab>
    </div>
    <div className="mobile-trade-content">
      {tab === "ticket" && <OrderTicket variant="mobile" />}
      {tab === "positions" && <MobilePositionList simulatorPositions={simulatorOpen} requestPrompt={requestPrompt} requestConfirm={requestConfirm} />}
      {tab === "copier" && <CopyRoutingPanel />}
      {tab === "activity" && <div className="mobile-bridge-workspace"><ExecutionConnectionStatus /><Mt5CommandLog />{executionMode !== "mt5" && <div className="mobile-empty-state"><strong>Simulator mode is active</strong><span>Select an execution account to inspect account-scoped events.</span></div>}</div>}
    </div>
    <Mt5ManagedConnectionDialog
      open={showManagedConnect}
      onClose={() => setShowManagedConnect(false)}
    />
    <Mt5EaSetupGuide
      open={showEaGuide}
      onClose={() => setShowEaGuide(false)}
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
      account={showAccountManagement ? selectedExecutionAccount : null}
      pairing={pairing}
      pairingLoading={pairingLoading}
      pairingFailed={pairingFailed}
      onClose={() => setShowAccountManagement(false)}
      onGeneratePairingToken={createPairingToken}
    />
    {dialog}
  </section>;
}

function MobileTradeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(active && "is-active")}
    >
      {children}
    </button>
  );
}

function MobilePositionList({
  simulatorPositions,
  requestPrompt,
  requestConfirm,
}: {
  simulatorPositions: Position[];
  requestPrompt: (options: PlatformPromptOptions) => Promise<string | null>;
  requestConfirm: (options: PlatformConfirmOptions) => Promise<boolean>;
}) {
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const mt5Pending = useAtomValue(mt5PendingOrdersAtom);
  const closeSimulator = useSetAtom(closePositionAtom);
  const cancelSimulator = useSetAtom(cancelPendingAtom);
  const closeMt5 = useSetAtom(closeMt5PositionAtom);
  const cancelMt5 = useSetAtom(cancelMt5OrderAtom);
  const replay = useReplayTrading();
  const [copyTrade, setCopyTrade] = useState<CopyableMt5Trade | null>(null);
  const [editingTrade, setEditingTrade] = useState<EditableMt5Trade | null>(null);

  if (executionMode === "mt5") {
    if (!mt5Positions.length && !mt5Pending.length) return <EmptyPositions message="Connect the bridge and send a live order from the ticket." />;
    return <>
    <div className="mobile-position-list">
      {mt5Positions.map((position) => {
        const precision = getMarketSymbol(position.symbol)?.pricePrecision ?? 2;
        return <article key={`mt5-${position.ticket}`} className="mobile-position-card">
          <PositionIdentity symbol={position.symbol} side={position.side} type="MT5 market" />
          <Metric label="Entry" value={fmtPrice(position.openPrice, precision)} />
          <Metric label="Current" value={fmtPrice(position.currentPrice, precision)} />
          <Metric label="Volume" value={position.volume.toFixed(4)} />
          <Metric label="Stop / target" value={`${position.sl ? fmtPrice(position.sl, precision) : "—"} / ${position.tp ? fmtPrice(position.tp, precision) : "—"}`} />
          <Metric label="P/L" value={fmtMoney(position.profit)} tone={position.profit} />
          <div className="mobile-position-actions">
            <button
              type="button"
              onClick={() => setEditingTrade({ kind: "position", position })}
            >
              <Pencil size={17} />Edit SL/TP
            </button>
            <button
              type="button"
              onClick={() => setCopyTrade({ kind: "position", position })}
            >
              <Copy size={17} />Copy
            </button>
            <button type="button" className="is-danger" onClick={() => {
            void requestConfirm({
              title: `Close MT5 ticket ${position.ticket}?`,
              description: "The live position will be closed at the broker.",
              confirmLabel: "Close position",
              tone: "danger",
            }).then((accepted) => {
              if (accepted) closeMt5({ clientOrderId: makeClientCommandId("exec_close"), ticket: position.ticket });
            });
          }}><X size={17} />Close</button></div>
        </article>;
      })}
      {mt5Pending.map((order) => {
        const precision = getMarketSymbol(order.symbol)?.pricePrecision ?? 2;
        return <article key={`mt5-order-${order.ticket}`} className="mobile-position-card">
          <PositionIdentity symbol={order.symbol} side={order.side === "buy" ? "long" : "short"} type={`MT5 ${order.type} pending`} />
          <Metric label="Entry" value={fmtPrice(order.price, precision)} />
          <Metric label="Volume" value={order.volume.toFixed(4)} />
          <Metric label="Stop / target" value={`${order.sl ? fmtPrice(order.sl, precision) : "—"} / ${order.tp ? fmtPrice(order.tp, precision) : "—"}`} />
          <div className="mobile-position-actions">
            <button
              type="button"
              onClick={() => setEditingTrade({ kind: "pendingOrder", order })}
            >
              <Pencil size={17} />Edit
            </button>
            <button
              type="button"
              onClick={() => setCopyTrade({ kind: "pendingOrder", order })}
            >
              <Copy size={17} />Copy
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                void requestConfirm({
                  title: `Cancel pending order ${order.ticket}?`,
                  description:
                    "The cancellation will be sent to the broker account.",
                  confirmLabel: "Cancel order",
                  tone: "danger",
                }).then((accepted) => {
                  if (!accepted) return;
                  cancelMt5({
                    clientOrderId: makeClientCommandId("exec_cancel"),
                    ticket: order.ticket,
                  });
                });
              }}
            >
              <Ban size={17} />Cancel
            </button>
          </div>
        </article>;
      })}
    </div>
    {copyTrade && (
      <CopyTradeDialog
        trade={copyTrade}
        onClose={() => setCopyTrade(null)}
      />
    )}
    {editingTrade && (
      <Mt5OrderEditorDialog
        trade={editingTrade}
        onClose={() => setEditingTrade(null)}
      />
    )}
    </>;
  }

  if (replay.active) {
    const active = replay.positions.filter((position) => Math.abs(position.netQuantity) > 1e-12);
    const pending = replay.orders.filter((order) => order.status === "pending" || order.status === "partially_filled");
    if (!active.length && !pending.length) return <EmptyPositions message="Orders and fills are isolated to this replay session." />;
    const symbol = replay.symbol ?? "Replay";
    const precision = getMarketSymbol(symbol)?.pricePrecision ?? 5;
    return <div className="mobile-position-list">
      {active.map((position) => {
        const side = position.netQuantity > 0 ? "long" : "short";
        const entryOrder = [...replay.orders].reverse().find((order) => order.trackId === position.trackId && order.status === "filled" && ((side === "long" && order.side === "buy") || (side === "short" && order.side === "sell")));
        const editBracket = () => {
          if (!entryOrder) return;
          void requestPrompt({
            title: "Replay stop loss",
            description: "Leave blank to remove the stop loss.",
            label: "Stop loss",
            defaultValue: position.stopLoss?.toString() ?? "",
            placeholder: "Optional price",
            confirmLabel: "Next",
          }).then((stopText) => {
            if (stopText == null) return;
            void requestPrompt({
              title: "Replay take profit",
              description: "Leave blank to remove the take profit.",
              label: "Take profit",
              defaultValue: position.takeProfit?.toString() ?? "",
              placeholder: "Optional price",
              confirmLabel: "Save bracket",
            }).then((targetText) => {
              if (targetText == null) return;
              const stopLoss = stopText.trim() ? Number(stopText) : undefined;
              const takeProfit = targetText.trim() ? Number(targetText) : undefined;
              if ((stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) || (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0))) return;
              void replay.updateBracket(entryOrder.id, stopLoss, takeProfit);
            });
          });
        };
        return <article key={position.id} className="mobile-position-card">
          <PositionIdentity symbol={symbol} side={side} type="Replay market" />
          <Metric label="Entry" value={fmtPrice(position.averagePrice, precision)} />
          <Metric label="Quantity" value={Math.abs(position.netQuantity).toFixed(4)} />
          <Metric label="Stop / target" value={`${position.stopLoss ? fmtPrice(position.stopLoss, precision) : "—"} / ${position.takeProfit ? fmtPrice(position.takeProfit, precision) : "—"}`} />
          <Metric label="P/L" value={fmtMoney(position.unrealizedPnl)} tone={position.unrealizedPnl} />
          <div className="mobile-position-actions"><button type="button" disabled={!entryOrder} onClick={editBracket}><Pencil size={17} />Bracket</button><button type="button" onClick={() => void replay.close(position.id, 0.5)}>Close ½</button><button type="button" className="is-danger" onClick={() => void replay.close(position.id)}><X size={17} />Close</button></div>
        </article>;
      })}
      {pending.map((order) => <article key={order.id} className="mobile-position-card"><PositionIdentity symbol={symbol} side={order.side === "buy" ? "long" : "short"} type={`Replay ${order.orderType} pending`} /><Metric label="Remaining" value={(order.quantity - order.filledQuantity).toFixed(4)} /><Metric label="Price" value={fmtPrice(order.limitPrice ?? order.stopPrice ?? 0, precision)} /><div className="mobile-position-actions"><button type="button" className="is-danger" onClick={() => void replay.cancel(order.id)}><Ban size={17} />Cancel order</button></div></article>)}
    </div>;
  }

  if (!simulatorPositions.length) return <EmptyPositions message="Place an order from the ticket to start tracking risk and P/L." />;
  return <div className="mobile-position-list">{simulatorPositions.map((position) => {
    const precision = getMarketSymbol(position.symbol)?.pricePrecision ?? 5;
    return <article key={position.id} className="mobile-position-card">
      <PositionIdentity symbol={position.symbol} side={position.side} type={`${position.type} · ${position.status}`} />
      <Metric label="Entry" value={fmtPrice(position.entry, precision)} />
      <Metric label="Size" value={position.remaining.toFixed(4)} />
      <Metric label="Stop / target" value={`${position.stopLoss ? fmtPrice(position.stopLoss, precision) : "—"} / ${position.takeProfit ? fmtPrice(position.takeProfit, precision) : "—"}`} />
      <Metric label="P/L" value={fmtMoney(position.unrealizedPnl)} tone={position.unrealizedPnl} />
      <div className="mobile-position-actions">{position.status === "pending" ? <button type="button" className="is-danger" onClick={() => cancelSimulator(position.id)}><Ban size={17} />Cancel order</button> : <><button type="button" onClick={() => closeSimulator({ id: position.id, fraction: .5 })}>Close ½</button><button type="button" className="is-danger" onClick={() => closeSimulator({ id: position.id })}><X size={17} />Close</button></>}</div>
    </article>;
  })}</div>;
}

function PositionIdentity({ symbol, side, type }: { symbol: string; side: "long" | "short"; type: string }) { return <div className="mobile-position-identity"><span className={cn("mobile-side", side === "long" ? "is-long" : "is-short")}>{side}</span><strong>{symbol}</strong><small>{type}</small></div>; }
function Metric({ label, value, tone }: { label: string; value: string; tone?: number }) { return <div><small>{label}</small><strong className={tone == null ? undefined : tone >= 0 ? "text-bull" : "text-bear"}>{value}</strong></div>; }
function EmptyPositions({ message }: { message: string }) { return <div className="mobile-empty-state"><strong>No open positions</strong><span>{message}</span></div>; }
