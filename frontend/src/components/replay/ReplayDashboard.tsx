"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { useAtomValue } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { smcSnapshotAtom } from "@/store/smcStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { useChartSeries } from "@/hooks/useChartSeries";
import {
  forkActiveReplay,
  runReplayCommand,
} from "@/services/replay/replaySocket";
import { fmtDateTime, parseDateInput } from "@/utils/time";
import { fmtPrice } from "@/utils/format";
import { getMarketSymbol } from "@/services/market-data/symbols";

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel-2 px-3 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="text-xs font-semibold" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function utcSession(time: number): string {
  const hour = new Date(time * 1000).getUTCHours();
  if (hour >= 13 && hour < 21) return "New York";
  if (hour >= 7 && hour < 16) return "London";
  if (hour >= 23 || hour < 8) return "Asian";
  return "Closed";
}

export function ReplayDashboard() {
  const projection = useReplayClientProjection();
  const symbol = useAtomValue(symbolAtom);
  const visible = useChartSeries();
  const smc = useAtomValue(smcSnapshotAtom);
  const [dateInput, setDateInput] = useState("");
  const snapshot = projection.snapshot;
  const track = snapshot?.tracks[0];
  const current = visible[visible.length - 1];
  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  const jump = () => {
    if (!snapshot) return;
    const time = parseDateInput(dateInput);
    if (time == null) return;
    const iso = new Date(time * 1000).toISOString();
    const command = time < Date.parse(snapshot.simulatedTime) / 1000
      ? forkActiveReplay(iso)
      : runReplayCommand("seek", { time: iso });
    void command.catch(() => undefined);
  };

  if (!snapshot) {
    return (
      <div className="p-3 text-2xs text-ink-faint">
        Replay is idle. Sign in and select a UTC time; the Go backend owns the clock,
        aggregation, revealed bars, and isolated trading ledger.
        {projection.error && <div className="mt-2 text-bear">{projection.error}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-2xs text-ink-faint">
          Source row {track?.cursorSeq ?? 0}/{track?.dataset.rowCount ?? 0}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <CalendarClock size={13} className="text-ink-faint" />
          <input
            value={dateInput}
            onChange={(event) => setDateInput(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && jump()}
            placeholder="YYYY-MM-DD HH:mm"
            className="w-40 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-2xs text-ink outline-none focus:border-brand"
          />
          <button onClick={jump} className="rounded bg-terminal-hover px-2 py-1 text-2xs text-ink hover:bg-brand hover:text-white">
            Jump
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <Stat label="Replay date" value={current ? fmtDateTime(current.time) : "—"} />
        <Stat label="Status" value={snapshot.status.toUpperCase()} />
        <Stat label="Speed" value={`${snapshot.speed}x`} accent="var(--accent)" />
        <Stat label="Price" value={current ? fmtPrice(current.close, precision) : "—"} />
        <Stat label="Trend" value={smc.trend.toUpperCase()} accent={smc.trend === "bullish" ? "var(--bull)" : smc.trend === "bearish" ? "var(--bear)" : "var(--text-muted)"} />
        <Stat label="Session" value={current ? utcSession(current.time) : "—"} accent="var(--choch)" />
      </div>

      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        <Stat label="Active FVG" value={smc.fvgs.filter((item) => item.state === "active").length} accent="var(--fvg)" />
        <Stat label="Order Blocks" value={smc.orderBlocks.filter((item) => item.state !== "invalidated").length} accent="var(--ob)" />
        <Stat label="Liquidity" value={smc.liquidity.filter((item) => !item.swept).length} accent="var(--liquidity)" />
        <Stat label="Structures" value={smc.structures.length} accent="var(--bos)" />
        <Stat label="Swings" value={smc.swings.length} />
        <Stat label="Displacements" value={smc.displacements.length} />
      </div>

      {snapshot.tracks.length > 1 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">
            Synchronized server tracks
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {snapshot.tracks.map((item) => {
              const bars = projection.barsByTrack[item.id] ?? [];
              const last = bars[bars.length - 1];
              return (
                <div key={item.id} className="rounded border border-terminal-border bg-terminal-panel-2 px-2 py-1.5">
                  <div className="text-2xs font-semibold text-ink">{item.symbol} · {item.chartTimeframe}</div>
                  <div className="text-2xs text-ink-muted">{last ? fmtPrice(last.close, precision) : "—"}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-2xs text-ink-faint">
        Connection: {projection.connection}{snapshot.pauseReason ? ` · ${snapshot.pauseReason}` : ""}
        {projection.error ? <span className="ml-2 text-bear">{projection.error}</span> : null}
      </div>
    </div>
  );
}
