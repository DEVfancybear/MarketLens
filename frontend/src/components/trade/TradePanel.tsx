"use client";
import { OrderTicket } from "./OrderTicket";
import { PositionsTable } from "./PositionsTable";
import {
  equityAtom,
  startingEquityAtom,
  positionsAtom,
  resetPersistedTradeAtom,
} from "@/store/tradeStore";
import {
  executionModeAtom,
  mt5AccountAtom,
  mt5PositionsAtom,
} from "@/store/mt5Store";
import { fmtMoney } from "@/utils/format";
import { useAtomValue, useSetAtom } from "jotai";
import { RotateCcw } from "lucide-react";
import { ExecutionModeSwitch } from "./ExecutionModeSwitch";
import { ExecutionConnectionStatus } from "./ExecutionConnectionStatus";
import { Mt5CommandLog } from "./Mt5CommandLog";
import { useReplayTrading } from "@/store/replayTradingClientStore";
import { useSimTradingPersistence } from "@/hooks/useSimTradingPersistence";

/** Trade simulator tab: order ticket + live positions, with account header. */
export function TradePanel() {
  useSimTradingPersistence();
  const equity = useAtomValue(equityAtom);
  const startingEquity = useAtomValue(startingEquityAtom);
  const positions = useAtomValue(positionsAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Account = useAtomValue(mt5AccountAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const reset = useSetAtom(resetPersistedTradeAtom);
  const replayTrading = useReplayTrading();
  const replayMode = replayTrading.active && executionMode === "simulator";

  const openPnl = positions
    .filter((p) => p.status === "open")
    .reduce((s, p) => s + p.unrealizedPnl, 0);
  const mt5OpenPnl = mt5Positions.reduce((s, p) => s + p.profit, 0);
  const replayOpenPnl = replayTrading.positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const activeEquity = replayMode
    ? replayTrading.account?.equity ?? equity
    : executionMode === "mt5" && mt5Account ? mt5Account.equity : equity;
  const activeOpenPnl = replayMode ? replayOpenPnl : executionMode === "mt5" ? mt5OpenPnl : openPnl;
  const activeStartingEquity = replayMode
    ? replayTrading.account?.startingEquity ?? startingEquity
    : startingEquity;
  const activeReturn = ((activeEquity - activeStartingEquity) / activeStartingEquity) * 100;

  const exportReplayReport = async () => {
    const report = await replayTrading.report();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `replay-report-${report.sessionId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full bg-terminal-panel">
      <OrderTicket />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-3 border-b border-terminal-border bg-terminal-panel px-3 py-1 text-2xs">
          <ExecutionModeSwitch />
          <Stat label="Equity" value={fmtMoney(activeEquity)} />
          <Stat
            label="Open P/L"
            value={fmtMoney(activeOpenPnl)}
            accent={activeOpenPnl >= 0 ? "var(--bull)" : "var(--bear)"}
          />
          {executionMode === "simulator" && (
            <>
              <Stat
                label="Return"
                value={`${activeReturn >= 0 ? "+" : ""}${activeReturn.toFixed(2)}%`}
                accent={activeReturn >= 0 ? "var(--bull)" : "var(--bear)"}
              />
              <button
                onClick={() => replayMode ? void replayTrading.reset() : void reset()}
                className="ml-auto flex items-center gap-1 rounded-xs px-2 py-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
              >
                <RotateCcw size={12} /> Reset account
              </button>
              {replayMode && (
                <button onClick={() => void exportReplayReport()} className="rounded-xs px-2 py-1 text-ink-muted hover:bg-terminal-hover hover:text-ink">
                  Export report
                </button>
              )}
            </>
          )}
          {executionMode === "mt5" && <ExecutionConnectionStatus />}
        </div>
        <PositionsTable />
        <Mt5CommandLog />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-ink-faint">{label}</span>
      <span
        className="tabular font-semibold text-ink"
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}
