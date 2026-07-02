"use client";
import { OrderTicket } from "./OrderTicket";
import { PositionsTable } from "./PositionsTable";
import {
  equityAtom,
  startingEquityAtom,
  positionsAtom,
  resetTradeAtom,
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
import { Mt5ConnectionPanel } from "./Mt5ConnectionPanel";
import { Mt5CommandLog } from "./Mt5CommandLog";

/** Trade simulator tab: order ticket + live positions, with account header. */
export function TradePanel() {
  const equity = useAtomValue(equityAtom);
  const startingEquity = useAtomValue(startingEquityAtom);
  const positions = useAtomValue(positionsAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Account = useAtomValue(mt5AccountAtom);
  const mt5Positions = useAtomValue(mt5PositionsAtom);
  const reset = useSetAtom(resetTradeAtom);

  const openPnl = positions
    .filter((p) => p.status === "open")
    .reduce((s, p) => s + p.unrealizedPnl, 0);
  const netReturn = ((equity - startingEquity) / startingEquity) * 100;
  const mt5OpenPnl = mt5Positions.reduce((s, p) => s + p.profit, 0);
  const activeEquity =
    executionMode === "mt5" && mt5Account ? mt5Account.equity : equity;
  const activeOpenPnl = executionMode === "mt5" ? mt5OpenPnl : openPnl;

  return (
    <div className="flex h-full">
      <OrderTicket />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-3 border-b border-terminal-border px-3 py-1 text-2xs">
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
                value={`${netReturn >= 0 ? "+" : ""}${netReturn.toFixed(2)}%`}
                accent={netReturn >= 0 ? "var(--bull)" : "var(--bear)"}
              />
              <button
                onClick={reset}
                className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
              >
                <RotateCcw size={12} /> Reset account
              </button>
            </>
          )}
          {executionMode === "mt5" && <Mt5ConnectionPanel />}
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
