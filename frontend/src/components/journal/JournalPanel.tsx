"use client";
import { useEffect, useState } from "react";
import {
  journalEntriesAtom,
  removeJournalEntryAtom,
  updateJournalEntryAtom,
  attachScreenshotAtom,
  loadJournalAtom,
  journalLoadingAtom,
  journalErrorAtom,
} from "@/store/journalStore";
import { useAtomValue, useSetAtom } from "jotai";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { captureChart } from "@/components/chart/chartRegistry";
import { exportCSV, exportExcel } from "@/services/exporters";
import { fmtMoney, fmtPrice, fmtR } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import { uid } from "@/utils/id";
import { logAtom } from "@/store/uiStore";
import { cn } from "@/utils/cn";
import {
  Camera,
  Download,
  FileSpreadsheet,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { ScreenshotPhase } from "@/types";
import { backendSessionAtom } from "@/store/authStore";

const PHASES: { phase: ScreenshotPhase; label: string }[] = [
  { phase: "before", label: "Before" },
  { phase: "after-entry", label: "After Entry" },
  { phase: "after-exit", label: "After Exit" },
];

/** Trade journal: entries, screenshots, notes and CSV/Excel export. */
export function JournalPanel() {
  const entries = useAtomValue(journalEntriesAtom);
  const remove = useSetAtom(removeJournalEntryAtom);
  const update = useSetAtom(updateJournalEntryAtom);
  const attach = useSetAtom(attachScreenshotAtom);
  const load = useSetAtom(loadJournalAtom);
  const loading = useAtomValue(journalLoadingAtom);
  const error = useAtomValue(journalErrorAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const log = useSetAtom(logAtom);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [backendSession, load]);

  const capture = async (entryId: string, phase: ScreenshotPhase) => {
    const blob = await captureChart();
    if (!blob) {
      log("warn", "Chart not ready for screenshot");
      return;
    }
    const thumb = URL.createObjectURL(blob);
    await attach(
      entryId,
      { id: uid("shot"), phase, thumb, createdAt: Date.now() / 1000 },
      blob,
    );
    log("info", `${phase} screenshot attached`);
  };

  const totalPnl = entries.reduce((s, e) => s + e.pnl, 0);

  return (
    <div className="flex h-full flex-col">
      {/* Header / export */}
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-terminal-border px-3 text-2xs">
        <span className="text-ink-faint">Trades</span>
        <span className="font-semibold text-ink">{entries.length}</span>
        <span className="text-ink-faint">Net</span>
        <span
          className="tabular font-semibold"
          style={{ color: totalPnl >= 0 ? "var(--bull)" : "var(--bear)" }}
        >
          {fmtMoney(totalPnl)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => exportCSV(entries)}
            disabled={!entries.length}
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-ink-muted hover:bg-terminal-hover hover:text-ink disabled:opacity-40"
          >
            <Download size={12} /> CSV
          </button>
          <button
            onClick={() => exportExcel(entries)}
            disabled={!entries.length}
            className="flex items-center gap-1 rounded-sm px-2 py-1 text-ink-muted hover:bg-terminal-hover hover:text-ink disabled:opacity-40"
          >
            <FileSpreadsheet size={12} /> Excel
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && entries.length === 0 && (
          <div className="px-3 py-6 text-center text-2xs text-ink-faint">
            Loading journal…
          </div>
        )}
        {error && (
          <div className="border-b border-terminal-border px-3 py-1.5 text-2xs text-choch">
            Backend sync unavailable. Showing the local journal cache.
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="px-3 py-6 text-center text-2xs text-ink-faint">
            No trades yet. Closed simulated trades are journaled automatically.
          </div>
        )}
        {entries.map((e) => {
          const prec = getMarketSymbol(e.symbol)?.pricePrecision ?? 2;
          const isOpen = expanded === e.id;
          return (
            <div key={e.id} className="border-b border-terminal-border">
              <div
                onClick={() => setExpanded(isOpen ? null : e.id)}
                className="grid cursor-pointer grid-cols-[16px_1fr_auto_auto_auto] items-center gap-2 px-3 py-1.5 text-2xs hover:bg-terminal-hover"
              >
                {isOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink">{e.symbol}</span>
                  <span
                    style={{
                      color: e.side === "long" ? "var(--bull)" : "var(--bear)",
                    }}
                  >
                    {e.side.toUpperCase()}
                  </span>
                  <span className="text-ink-faint">
                    {fmtDateTime(e.entryTime)}
                  </span>
                </div>
                <span className="tabular text-ink-muted">{fmtR(e.rr)}</span>
                <span
                  className="tabular font-semibold"
                  style={{ color: e.pnl >= 0 ? "var(--bull)" : "var(--bear)" }}
                >
                  {fmtMoney(e.pnl)}
                </span>
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    remove(e.id);
                  }}
                  title="Delete"
                >
                  <Trash2
                    size={12}
                    className="text-ink-faint hover:text-bear"
                  />
                </button>
              </div>

              {isOpen && (
                <div className="space-y-2 bg-terminal-panel-2/40 px-9 py-2">
                  <div className="grid grid-cols-4 gap-2 text-2xs">
                    <Detail
                      label="Entry"
                      value={fmtPrice(e.entryPrice, prec)}
                    />
                    <Detail label="Exit" value={fmtPrice(e.exitPrice, prec)} />
                    <Detail label="Qty" value={e.quantity.toFixed(4)} />
                    <Detail label="Risk" value={fmtMoney(e.riskAmount)} />
                    <Detail label="Exit time" value={fmtDateTime(e.exitTime)} />
                  </div>

                  <textarea
                    defaultValue={e.notes ?? ""}
                    onBlur={(ev) => update(e.id, { notes: ev.target.value })}
                    placeholder="Trade notes / rationale…"
                    className="h-14 w-full resize-none rounded-sm border border-terminal-border bg-terminal-bg p-2 text-2xs text-ink outline-hidden focus:border-brand"
                  />

                  {/* Screenshots */}
                  <div className="flex items-center gap-2">
                    {PHASES.map((p) => (
                      <button
                        key={p.phase}
                        onClick={() => capture(e.id, p.phase)}
                        className="flex items-center gap-1 rounded-sm border border-terminal-border px-2 py-1 text-[10px] text-ink-muted hover:bg-terminal-hover hover:text-ink"
                      >
                        <Camera size={11} /> {p.label}
                      </button>
                    ))}
                  </div>
                  {e.screenshots && e.screenshots.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {e.screenshots.map((s) => (
                        <a
                          key={s.id}
                          href={s.thumb || undefined}
                          target={s.thumb ? "_blank" : undefined}
                          rel={s.thumb ? "noreferrer" : undefined}
                          className="group relative"
                        >
                          {s.thumb ? (
                            <img
                              src={s.thumb}
                              alt={s.phase}
                              className="h-16 w-28 rounded-sm border border-terminal-border object-cover"
                            />
                          ) : (
                            <span className="flex h-16 w-28 items-center justify-center rounded-sm border border-terminal-border text-[9px] text-ink-faint">
                              Preview unavailable
                            </span>
                          )}
                          <span
                            className={cn(
                              "absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[8px] uppercase text-white",
                            )}
                          >
                            {s.phase}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase text-ink-faint">{label}</span>
      <span className="tabular text-ink">{value}</span>
    </div>
  );
}
