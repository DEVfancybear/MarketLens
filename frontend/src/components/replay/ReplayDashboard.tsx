"use client";
import { useMemo, useState } from "react";
import { useReplayStore } from "@/store/replayStore";
import { useAtomValue } from "jotai";
import { symbolAtom, candlesAtom } from "@/store/chartStore";
import { smcSnapshotAtom } from "@/store/smcStore";
import { useVisibleCandles } from "@/hooks/useVisibleCandles";
import {
  indexNearestByTime,
  mtfSnapshot,
  quickTrend,
  sessionAt,
} from "@/services/replayEngine";
import { fmtDateTime, parseDateInput } from "@/utils/time";
import { fmtPrice } from "@/utils/format";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { useMtfSnapshotSeries } from "@/hooks/useMtfSnapshotSeries";
import { cn } from "@/utils/cn";
import { CalendarClock } from "lucide-react";

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel-2 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="text-xs font-semibold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

const trendColor = (t: string) =>
  t === "bullish"
    ? "var(--bull)"
    : t === "bearish"
      ? "var(--bear)"
      : "var(--text-muted)";

export function ReplayDashboard() {
  const r = useReplayStore();
  const symbol = useAtomValue(symbolAtom);
  const candles = useAtomValue(candlesAtom);
  const visible = useVisibleCandles();
  const snap = useAtomValue(smcSnapshotAtom);
  const [dateInput, setDateInput] = useState("");

  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const current = visible[visible.length - 1];
  const trend = snap.trend !== "ranging" ? snap.trend : quickTrend(visible);
  const session = current ? sessionAt(current.time) : "—";

  // Higher-TF history from the real HistoricalDataService (replaces the old mock).
  const mtfSeries = useMtfSnapshotSeries(symbol, r.active);
  const mtf = useMemo(
    () => (r.active && current ? mtfSnapshot(current.time, mtfSeries) : []),
    // Only the current candle's time + the loaded series matter for the snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r.active, current?.time, mtfSeries],
  );

  const jump = () => {
    const t = parseDateInput(dateInput);
    if (t == null || !candles.length) return;
    const idx = indexNearestByTime(candles, t);
    r.arm(idx, candles.length);
  };

  if (!r.active) {
    return (
      <div className="p-3 text-2xs text-ink-faint">
        Replay is idle. Start it from the controls above or the toolbar. The
        engine hides every candle after the cursor — no look-ahead, no
        future-data leakage.
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {/* Scrubber */}
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-2xs text-ink-faint">
          {r.cursor - r.anchor + 1}/{r.total - r.anchor}
        </span>
        <input
          type="range"
          min={r.anchor}
          max={r.total - 1}
          value={r.cursor}
          onChange={(e) => {
            r.pause();
            r.setCursor(Number(e.target.value));
          }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded bg-terminal-border accent-brand"
        />
        {/* Jump to date */}
        <div className="flex items-center gap-1">
          <CalendarClock size={13} className="text-ink-faint" />
          <input
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && jump()}
            placeholder="YYYY-MM-DD HH:mm"
            className="w-40 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-2xs text-ink outline-none focus:border-brand"
          />
          <button
            onClick={jump}
            className="rounded bg-terminal-hover px-2 py-1 text-2xs text-ink hover:bg-brand hover:text-white"
          >
            Jump
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <Stat
          label="Replay date"
          value={current ? fmtDateTime(current.time) : "—"}
        />
        <Stat label="Candle" value={`#${r.cursor + 1}`} />
        <Stat label="Speed" value={`${r.speed}x`} accent="var(--accent)" />
        <Stat
          label="Price"
          value={current ? fmtPrice(current.close, prec) : "—"}
        />
        <Stat
          label="Trend"
          value={trend.toUpperCase()}
          accent={trendColor(trend)}
        />
        <Stat label="Session" value={session} accent="var(--choch)" />
      </div>

      {/* SMC active counts */}
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <Stat
          label="Active FVG"
          value={snap.fvgs.filter((f) => f.state === "active").length}
          accent="var(--fvg)"
        />
        <Stat
          label="Order Blocks"
          value={
            snap.orderBlocks.filter((o) => o.state !== "invalidated").length
          }
          accent="var(--ob)"
        />
        <Stat
          label="Liquidity"
          value={snap.liquidity.filter((l) => !l.swept).length}
          accent="var(--liquidity)"
        />
        <Stat
          label="Structures"
          value={snap.structures.length}
          accent="var(--bos)"
        />
        <Stat label="Swings" value={snap.swings.length} />
        <Stat label="Displacements" value={snap.displacements.length} />
      </div>

      {/* Multi-timeframe sync */}
      {mtf.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">
            Multi-timeframe (synced, no look-ahead)
          </div>
          <div className="grid grid-cols-5 gap-2">
            {mtf.map((row) => (
              <div
                key={row.timeframe}
                className="rounded border border-terminal-border bg-terminal-panel-2 px-2 py-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-2xs font-semibold text-ink">
                    {row.timeframe}
                  </span>
                  <span
                    className={cn("text-[9px] font-semibold uppercase")}
                    style={{ color: trendColor(row.trend) }}
                  >
                    {row.trend === "bullish"
                      ? "▲"
                      : row.trend === "bearish"
                        ? "▼"
                        : "◆"}
                  </span>
                </div>
                <div className="tabular text-2xs text-ink-muted">
                  {row.candle ? fmtPrice(row.candle.close, prec) : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
