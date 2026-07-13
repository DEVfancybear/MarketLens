"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Activity,
  BarChart3,
  CalendarDays,
  CloudOff,
  Gauge,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import {
  journalEntriesAtom,
  journalErrorAtom,
  journalLoadedAtom,
  journalLoadingAtom,
  loadJournalAtom,
} from "@/store/journalStore";
import { startingEquityAtom } from "@/store/analyticsStore";
import { backendSessionAtom } from "@/store/authStore";
import { computeAnalytics } from "@/services/analyticsEngine";
import { fmtMoney, fmtPct } from "@/utils/format";
import { cn } from "@/utils/cn";
import type { DistributionBucket, MonthlyStat } from "@/types";

const BUCKET_LABELS = [
  "\u2264 -2R",
  "-2 to -1R",
  "-1 to 0R",
  "0 to 1R",
  "1 to 2R",
  "2 to 3R",
  "\u2265 3R",
] as const;

/** Touch-first analytics composed directly from shared journal state. */
export function MobileAnalyticsWorkspace() {
  const entries = useAtomValue(journalEntriesAtom);
  const loaded = useAtomValue(journalLoadedAtom);
  const loading = useAtomValue(journalLoadingAtom);
  const error = useAtomValue(journalErrorAtom);
  const startingEquity = useAtomValue(startingEquityAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const loadJournal = useSetAtom(loadJournalAtom);

  useEffect(() => {
    void loadJournal();
  }, [backendSession, loadJournal]);

  const report = useMemo(
    () => computeAnalytics(entries, startingEquity),
    [entries, startingEquity],
  );

  if (!loaded && loading) return <AnalyticsLoading />;

  const summary = report.summary;
  const returnPct = startingEquity
    ? (summary.netPnl / startingEquity) * 100
    : 0;
  const profitFactor =
    summary.profitFactor === Infinity
      ? "\u221e"
      : summary.profitFactor.toFixed(2);
  const maxDistribution = Math.max(
    ...report.distribution.map((bucket) => bucket.count),
    1,
  );
  const maxMonth = Math.max(
    ...report.monthly.map((month) => Math.abs(month.pnl)),
    1,
  );
  const equityValues = [
    startingEquity,
    ...report.equity.map((point) => point.equity),
  ];

  return (
    <section className="mobile-screen" aria-labelledby="mobile-analytics-title">
      <header className="mobile-screen-header">
        <div>
          <small>ANALYTICS</small>
          <h1 id="mobile-analytics-title">Performance intelligence</h1>
        </div>
        <div
          className="flex min-h-11 items-center gap-2 rounded-xl border border-terminal-border bg-terminal-panel px-3 text-ink-muted"
          aria-label={`${summary.totalTrades} analyzed trades`}
        >
          <Activity size={17} className="text-brand" aria-hidden="true" />
          <span className="tabular text-sm font-bold text-ink">
            {summary.totalTrades}
          </span>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-3 flex gap-3 rounded-2xl border border-choch/30 bg-choch/10 p-3 text-sm text-ink-muted"
        >
          <CloudOff
            size={19}
            className="mt-0.5 shrink-0 text-choch"
            aria-hidden="true"
          />
          <div>
            <strong className="block text-ink">Journal sync is limited</strong>
            <span className="mt-1 block text-xs leading-5">
              Showing cached performance. Reconnect your session to refresh the
              journal. {error}
            </span>
          </div>
        </div>
      )}

      {summary.totalTrades === 0 ? (
        <AnalyticsEmpty />
      ) : (
        <>
          <section
            className="relative overflow-hidden rounded-[20px] border border-brand/25 bg-terminal-panel p-5 shadow-accent"
            aria-label="Net performance"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-ink-muted">
                  Net realized P/L
                </span>
                <div
                  className={cn(
                    "mt-2 tabular text-[30px] font-bold leading-none tracking-[-0.04em]",
                    valueTone(summary.netPnl),
                  )}
                >
                  {signedMoney(summary.netPnl)}
                </div>
                <span
                  className={cn(
                    "mt-2 inline-flex items-center gap-1.5 text-xs font-bold",
                    valueTone(returnPct),
                  )}
                >
                  {returnPct >= 0 ? (
                    <TrendingUp size={15} aria-hidden="true" />
                  ) : (
                    <TrendingDown size={15} aria-hidden="true" />
                  )}
                  {fmtPct(returnPct)} from starting equity
                </span>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <BarChart3 size={21} aria-hidden="true" />
              </span>
            </div>
          </section>

          <div className="mt-3 grid grid-cols-2 gap-2.5" aria-label="Key metrics">
            <KpiCard
              icon={<Target />}
              label="Win rate"
              value={`${summary.winRate.toFixed(1)}%`}
              detail={`${summary.wins} wins / ${summary.losses} losses`}
              tone="text-brand"
            />
            <KpiCard
              icon={<Gauge />}
              label="Profit factor"
              value={profitFactor}
              detail={`${fmtMoney(summary.grossProfit)} gross profit`}
              tone="text-brand"
            />
            <KpiCard
              icon={<Sparkles />}
              label="Expectancy"
              value={signedMoney(summary.expectancy)}
              detail="Average result per trade"
              tone={valueTone(summary.expectancy)}
            />
            <KpiCard
              icon={<ShieldAlert />}
              label="Max drawdown"
              value={fmtPct(summary.maxDrawdownPct)}
              detail={fmtMoney(summary.maxDrawdown)}
              tone="text-bear"
            />
          </div>

          <section className="mt-3 rounded-2xl border border-terminal-border bg-terminal-panel p-4">
            <SectionHeading
              title="Equity pulse"
              detail={`${fmtMoney(startingEquity)} to ${fmtMoney(equityValues.at(-1) ?? startingEquity)}`}
            />
            <EquitySparkline
              values={equityValues}
              positive={summary.netPnl >= 0}
            />
          </section>

          <section className="mt-3 rounded-2xl border border-terminal-border bg-terminal-panel p-4">
            <SectionHeading title="Trade quality" detail="Average outcomes" />
            <div className="grid grid-cols-2 gap-2.5">
              <CompactStat label="Average R" value={`${summary.avgRR.toFixed(2)}R`} />
              <CompactStat
                label="Breakeven"
                value={String(summary.breakeven)}
              />
              <CompactStat
                label="Average win"
                value={fmtMoney(summary.avgWin)}
                tone="text-bull"
              />
              <CompactStat
                label="Average loss"
                value={fmtMoney(-summary.avgLoss)}
                tone="text-bear"
              />
              <CompactStat
                label="Best streak"
                value={`${summary.longestWinStreak} wins`}
                tone="text-bull"
              />
              <CompactStat
                label="Loss streak"
                value={`${summary.longestLossStreak} losses`}
                tone="text-bear"
              />
            </div>
          </section>

          <section className="mt-3 rounded-2xl border border-terminal-border bg-terminal-panel p-4">
            <SectionHeading title="R distribution" detail="Outcome frequency" />
            <div className="space-y-3" role="list">
              {report.distribution.map((bucket, index) => (
                <DistributionRow
                  key={`${index}:${bucket.label}`}
                  bucket={bucket}
                  index={index}
                  max={maxDistribution}
                />
              ))}
            </div>
          </section>

          <section className="mt-3 rounded-2xl border border-terminal-border bg-terminal-panel p-4">
            <SectionHeading
              title="Monthly performance"
              detail={`${report.monthly.length} active months`}
            />
            <div className="space-y-2.5" role="list">
              {[...report.monthly].reverse().map((month) => (
                <MonthRow key={month.month} month={month} max={maxMonth} />
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}

function AnalyticsLoading() {
  return (
    <section className="mobile-screen" role="status" aria-live="polite">
      <header className="mobile-screen-header">
        <div>
          <small>ANALYTICS</small>
          <h1>Performance intelligence</h1>
        </div>
      </header>
      <span className="sr-only">Loading performance analytics</span>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        <div className="h-36 rounded-[20px] bg-terminal-panel" />
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-28 rounded-2xl bg-terminal-panel"
            />
          ))}
        </div>
        <div className="h-48 rounded-2xl bg-terminal-panel" />
      </div>
    </section>
  );
}

function AnalyticsEmpty() {
  return (
    <div className="mobile-empty-state rounded-2xl border border-terminal-border bg-terminal-panel">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
        <BarChart3 size={22} aria-hidden="true" />
      </span>
      <strong>No closed trades yet</strong>
      <span>
        Performance metrics, R distribution, and monthly results appear after
        your first journaled exit.
      </span>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className="flex min-h-[116px] flex-col rounded-2xl border border-terminal-border bg-terminal-panel p-3.5">
      <div className="flex items-center gap-2 text-ink-muted">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-terminal-panel-3 text-brand [&>svg]:h-4 [&>svg]:w-4">
          {icon}
        </span>
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <strong
        className={cn(
          "mt-3 tabular text-lg font-bold leading-none text-ink",
          tone,
        )}
      >
        {value}
      </strong>
      <span className="mt-auto pt-2 text-[11px] leading-4 text-ink-faint">
        {detail}
      </span>
    </article>
  );
}

function CompactStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-terminal-panel-2 p-3">
      <span className="block text-[11px] text-ink-faint">{label}</span>
      <strong
        className={cn("mt-1 block tabular text-sm font-bold text-ink", tone)}
      >
        {value}
      </strong>
    </div>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 className="text-[15px] font-bold text-ink">{title}</h2>
      <span className="text-right text-[11px] text-ink-faint">{detail}</span>
    </div>
  );
}

function EquitySparkline({
  values,
  positive,
}: {
  values: number[];
  positive: boolean;
}) {
  const points = sparklinePoints(values, 320, 104);
  const first = values[0] ?? 0;
  const last = values.at(-1) ?? first;
  return (
    <svg
      viewBox="0 0 320 104"
      preserveAspectRatio="none"
      className={cn("h-28 w-full", positive ? "text-bull" : "text-bear")}
      role="img"
      aria-label={`Equity moved from ${fmtMoney(first)} to ${fmtMoney(last)}`}
    >
      <line
        x1="0"
        y1="52"
        x2="320"
        y2="52"
        stroke="var(--border)"
        strokeDasharray="4 6"
      />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function DistributionRow({
  bucket,
  index,
  max,
}: {
  bucket: DistributionBucket;
  index: number;
  max: number;
}) {
  const positive = index >= 3;
  const width = bucket.count ? Math.max(6, (bucket.count / max) * 100) : 0;
  const label = BUCKET_LABELS[index] ?? bucket.label;
  return (
    <div
      role="listitem"
      aria-label={`${label}: ${bucket.count} trades, ${fmtMoney(bucket.pnl)}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-ink-muted">{label}</span>
        <span className="tabular text-ink-faint">
          {bucket.count} trades / {signedMoney(bucket.pnl)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-terminal-panel-3">
        <div
          className={cn(
            "h-full rounded-full",
            positive ? "bg-bull" : "bg-bear",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function MonthRow({ month, max }: { month: MonthlyStat; max: number }) {
  const positive = month.pnl >= 0;
  const width = month.pnl
    ? Math.max(6, (Math.abs(month.pnl) / max) * 100)
    : 0;
  return (
    <article
      role="listitem"
      className="min-h-16 rounded-xl bg-terminal-panel-2 p-3"
      aria-label={`${formatMonth(month.month)}: ${fmtMoney(month.pnl)}, ${month.trades} trades, ${month.winRate.toFixed(0)} percent win rate`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-terminal-panel-3 text-brand">
          <CalendarDays size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <strong className="truncate text-sm text-ink">
              {formatMonth(month.month)}
            </strong>
            <strong
              className={cn(
                "shrink-0 tabular text-sm",
                positive ? "text-bull" : "text-bear",
              )}
            >
              {signedMoney(month.pnl)}
            </strong>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-terminal-panel-3">
              <div
                className={cn(
                  "h-full rounded-full",
                  positive ? "bg-bull" : "bg-bear",
                )}
                style={{ width: `${width}%` }}
              />
            </div>
            <span className="shrink-0 text-[11px] text-ink-faint">
              {month.trades} trades / {month.winRate.toFixed(0)}%
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function sparklinePoints(values: number[], width: number, height: number) {
  if (values.length < 2) return `0,${height / 2} ${width},${height / 2}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 12) - 6;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function signedMoney(value: number) {
  return `${value > 0 ? "+" : ""}${fmtMoney(value)}`;
}

function valueTone(value: number) {
  if (value > 0) return "text-bull";
  if (value < 0) return "text-bear";
  return "text-ink";
}
