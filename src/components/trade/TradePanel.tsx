"use client";
import { OrderTicket } from "./OrderTicket";
import { PositionsTable } from "./PositionsTable";
import {
  equityAtom,
  startingEquityAtom,
  positionsAtom,
  resetTradeAtom,
} from "@/store/tradeStore";
import { fmtMoney } from "@/utils/format";
import { useAtomValue, useSetAtom } from "jotai";
import { RotateCcw } from "lucide-react";

/** Trade simulator tab: order ticket + live positions, with account header. */
export function TradePanel() {
  const equity = useAtomValue(equityAtom);
  const startingEquity = useAtomValue(startingEquityAtom);
  const positions = useAtomValue(positionsAtom);
  const reset = useSetAtom(resetTradeAtom);

  const openPnl = positions
    .filter((p) => p.status === "open")
    .reduce((s, p) => s + p.unrealizedPnl, 0);
  const netReturn = ((equity - startingEquity) / startingEquity) * 100;

  return (
    <div className="flex h-full">
      <OrderTicket />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-4 border-b border-terminal-border px-3 text-2xs">
          <Stat label="Equity" value={fmtMoney(equity)} />
          <Stat
            label="Open P/L"
            value={fmtMoney(openPnl)}
            accent={openPnl >= 0 ? "var(--bull)" : "var(--bear)"}
          />
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
        </div>
        <PositionsTable />
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
