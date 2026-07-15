"use client";
import { equityAtom, positionsAtom } from "@/store/tradeStore";
import { fmtMoney } from "@/utils/format";
import { fmtR } from "@/utils/format";
import { rMultiple } from "@/services/tradeEngine";
import { useAtomValue } from "jotai";
import { cn } from "@/utils/cn";
import { useTerminalPlatform } from "@/hooks/useTerminalPlatform";
import { ChartPopupSurface } from "@/components/chart/ChartPopupSurface";

/**
 * Floating risk panel pinned to the chart. Shows account equity and live risk
 * exposure for open positions in the current view.
 */
export function RiskPanel() {
  const platform = useTerminalPlatform();
  const equity = useAtomValue(equityAtom);
  const positions = useAtomValue(positionsAtom);

  const open = positions.filter((p) => p.status === "open");
  if (open.length === 0) return null;

  const openPnl = open.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalRisk = open.reduce((s, p) => s + p.riskAmount, 0);
  const blendedR = open.length
    ? open.reduce((s, p) => s + rMultiple(p.unrealizedPnl, p.riskAmount), 0) /
      open.length
    : 0;

  const content = (
    <>
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
        Risk monitor
      </div>
      <Row
        label="Open P/L"
        value={fmtMoney(openPnl)}
        accent={openPnl >= 0 ? "var(--bull)" : "var(--bear)"}
      />
      <Row
        label="Open R"
        value={fmtR(blendedR)}
        accent={blendedR >= 0 ? "var(--bull)" : "var(--bear)"}
      />
      <Row label="Risk on" value={fmtMoney(totalRisk)} accent="var(--bear)" />
      <Row label="Positions" value={String(open.length)} />
      <div className="mt-1.5 border-t border-terminal-border pt-1.5">
        <Row label="Equity" value={fmtMoney(equity)} bold />
      </div>
    </>
  );

  if (platform === "mobile") {
    return (
      <ChartPopupSurface
        dragLabel="Move risk monitor"
        handleClassName="risk-panel-drag-handle"
        className="pointer-events-none absolute right-2 top-[72px] z-10 flex w-44 flex-col rounded-xl border border-terminal-border-strong bg-terminal-raised/95 p-3 shadow-floating backdrop-blur-xl"
      >
        {content}
      </ChartPopupSurface>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 w-44 rounded-xl border border-terminal-border-strong bg-terminal-raised/95 p-3 shadow-floating backdrop-blur-xl">
      {content}
    </div>
  );
}

function Row({
  label,
  value,
  accent,
  bold,
}: {
  label: string;
  value: string;
  accent?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-0.5 text-2xs">
      <span className="text-ink-faint">{label}</span>
      <span
        className={cn("tabular", bold ? "font-bold text-ink" : "font-semibold")}
        style={{ color: accent }}
      >
        {value}
      </span>
    </div>
  );
}
