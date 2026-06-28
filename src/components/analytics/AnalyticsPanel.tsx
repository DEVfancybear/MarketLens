"use client";
import { useMemo } from "react";
import { journalEntriesAtom } from "@/store/journalStore";
import { useAtomValue } from "jotai";
import { startingEquityAtom } from "@/store/analyticsStore";
import { computeAnalytics } from "@/services/analyticsEngine";
import { EquityChart } from "./EquityChart";
import { fmtMoney, fmtPct } from "@/utils/format";
import { cn } from "@/utils/cn";

/** Performance analytics dashboard: KPIs, equity curve, distributions. */
export function AnalyticsPanel() {
  const entries = useAtomValue(journalEntriesAtom);
  const startingEquity = useAtomValue(startingEquityAtom);

  const report = useMemo(
    () => computeAnalytics(entries, startingEquity),
    [entries, startingEquity],
  );
  const s = report.summary;

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-2xs text-ink-faint">
        No closed trades yet — analytics populate automatically as you trade in
        replay.
      </div>
    );
  }

  const pf = s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2);
  const maxBar = Math.max(...report.distribution.map((d) => d.count), 1);
  const maxMonth = Math.max(...report.monthly.map((m) => Math.abs(m.pnl)), 1);

  return (
    <div className="h-full overflow-auto p-3">
      {/* KPI cards */}
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <Kpi
          label="Net P/L"
          value={fmtMoney(s.netPnl)}
          accent={s.netPnl >= 0 ? "var(--bull)" : "var(--bear)"}
        />
        <Kpi label="Win Rate" value={`${s.winRate.toFixed(1)}%`} />
        <Kpi label="Profit Factor" value={pf} accent="var(--accent)" />
        <Kpi label="Avg R:R" value={`${s.avgRR.toFixed(2)}R`} />
        <Kpi
          label="Expectancy"
          value={fmtMoney(s.expectancy)}
          accent={s.expectancy >= 0 ? "var(--bull)" : "var(--bear)"}
        />
        <Kpi
          label="Max DD"
          value={fmtPct(s.maxDrawdownPct)}
          accent="var(--bear)"
        />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6">
        <Kpi label="Trades" value={String(s.totalTrades)} small />
        <Kpi label="Wins / Losses" value={`${s.wins} / ${s.losses}`} small />
        <Kpi
          label="Avg Win"
          value={fmtMoney(s.avgWin)}
          accent="var(--bull)"
          small
        />
        <Kpi
          label="Avg Loss"
          value={fmtMoney(-s.avgLoss)}
          accent="var(--bear)"
          small
        />
        <Kpi label="Win Streak" value={String(s.longestWinStreak)} small />
        <Kpi label="Loss Streak" value={String(s.longestLossStreak)} small />
      </div>

      {/* Equity + drawdown */}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle>Equity & Drawdown Curve</SectionTitle>
          <div className="h-48 rounded border border-terminal-border bg-terminal-panel-2">
            <EquityChart equity={report.equity} />
          </div>
        </div>

        {/* R distribution */}
        <div>
          <SectionTitle>Win / Loss Distribution (R)</SectionTitle>
          <div className="space-y-1 rounded border border-terminal-border bg-terminal-panel-2 p-3">
            {report.distribution.map((d) => {
              const win = !d.label.includes("-") && !d.label.startsWith("≤");
              return (
                <div
                  key={d.label}
                  className="flex items-center gap-2 text-[10px]"
                >
                  <span className="w-14 shrink-0 text-ink-faint">
                    {d.label}
                  </span>
                  <div className="h-3 flex-1 overflow-hidden rounded bg-terminal-bg">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${(d.count / maxBar) * 100}%`,
                        background: win ? "var(--bull)" : "var(--bear)",
                      }}
                    />
                  </div>
                  <span className="w-5 text-right tabular text-ink-muted">
                    {d.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Monthly performance */}
      <div className="mt-3">
        <SectionTitle>Monthly Performance</SectionTitle>
        <div className="flex items-end gap-2 overflow-x-auto rounded border border-terminal-border bg-terminal-panel-2 p-3">
          {report.monthly.map((m) => {
            const h = (Math.abs(m.pnl) / maxMonth) * 60;
            const up = m.pnl >= 0;
            return (
              <div
                key={m.month}
                className="flex w-14 shrink-0 flex-col items-center gap-1"
              >
                <span
                  className="tabular text-[9px]"
                  style={{ color: up ? "var(--bull)" : "var(--bear)" }}
                >
                  {fmtMoney(m.pnl)}
                </span>
                <div className="flex h-[64px] items-end">
                  <div
                    className="w-6 rounded-t"
                    style={{
                      height: `${Math.max(2, h)}px`,
                      background: up ? "var(--bull)" : "var(--bear)",
                    }}
                  />
                </div>
                <span className="text-[9px] text-ink-faint">
                  {m.month.slice(2)}
                </span>
                <span className="text-[8px] text-ink-faint">
                  {m.trades}t · {m.winRate.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: string;
  small?: boolean;
}) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel-2 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div
        className={cn("font-semibold tabular", small ? "text-xs" : "text-sm")}
        style={{ color: accent }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  );
}
