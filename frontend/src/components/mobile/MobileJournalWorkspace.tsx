"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Camera,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Image as ImageIcon,
  Loader2,
  NotebookTabs,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  attachScreenshotAtom,
  journalEntriesAtom,
  journalErrorAtom,
  journalLoadingAtom,
  loadJournalAtom,
  removeJournalEntryAtom,
  updateJournalEntryAtom,
} from "@/store/journalStore";
import { backendSessionAtom } from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { exportCSV, exportExcel } from "@/services/exporters";
import { captureChart } from "@/components/chart/chartRegistry";
import { fmtMoney, fmtPrice, fmtR } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import { uid } from "@/utils/id";
import { cn } from "@/utils/cn";
import type { JournalEntry, ScreenshotPhase } from "@/types";

const PHASES: { phase: ScreenshotPhase; label: string }[] = [
  { phase: "before", label: "Before" },
  { phase: "after-entry", label: "After entry" },
  { phase: "after-exit", label: "After exit" },
];

type CaptureNotice = {
  entryId: string;
  message: string;
  tone: "success" | "error";
};

/** Mobile-first journal presentation backed by the shared journal atoms. */
export function MobileJournalWorkspace() {
  const entries = useAtomValue(journalEntriesAtom);
  const loading = useAtomValue(journalLoadingAtom);
  const error = useAtomValue(journalErrorAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const load = useSetAtom(loadJournalAtom);
  const update = useSetAtom(updateJournalEntryAtom);
  const remove = useSetAtom(removeJournalEntryAtom);
  const attach = useSetAtom(attachScreenshotAtom);
  const log = useSetAtom(logAtom);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<CaptureNotice | null>(null);

  useEffect(() => {
    void load();
  }, [backendSession, load]);

  const summary = useMemo(() => {
    const net = entries.reduce((total, entry) => total + entry.pnl, 0);
    const winners = entries.filter((entry) => entry.pnl > 0).length;
    const averageR = entries.length
      ? entries.reduce((total, entry) => total + entry.rr, 0) / entries.length
      : 0;
    return {
      net,
      winRate: entries.length ? (winners / entries.length) * 100 : 0,
      averageR,
    };
  }, [entries]);

  const capture = async (entryId: string, phase: ScreenshotPhase) => {
    const captureKey = `${entryId}:${phase}`;
    setCapturing(captureKey);
    setCaptureNotice(null);
    try {
      const blob = await captureChart();
      if (!blob) {
        const message = "Chart is not ready for capture.";
        setCaptureNotice({ entryId, message, tone: "error" });
        log("warn", message);
        return;
      }

      const thumb = URL.createObjectURL(blob);
      await attach(
        entryId,
        {
          id: uid("shot"),
          phase,
          thumb,
          createdAt: Date.now() / 1000,
        },
        blob,
      );
      const phaseLabel = PHASES.find((item) => item.phase === phase)?.label ?? phase;
      setCaptureNotice({
        entryId,
        message: `${phaseLabel} chart attached.`,
        tone: "success",
      });
      log("info", `${phase} screenshot attached`);
    } catch (captureError) {
      const message =
        captureError instanceof Error
          ? captureError.message
          : "Unable to attach chart capture.";
      setCaptureNotice({ entryId, message, tone: "error" });
      log("error", `Journal screenshot failed: ${message}`);
    } finally {
      setCapturing(null);
    }
  };

  const runExport = (type: "csv" | "excel") => {
    if (type === "csv") exportCSV(entries);
    else exportExcel(entries);
    log("info", `Journal exported as ${type === "csv" ? "CSV" : "Excel"}`);
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-terminal-bg text-ink"
      aria-labelledby="mobile-journal-title"
    >
      <div className="shrink-0 border-b border-terminal-border bg-terminal-panel px-4 pb-4 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand">
            <NotebookTabs size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="mobile-journal-title" className="text-base font-semibold tracking-tight">
              Trade journal
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Review executions, notes and chart evidence.
            </p>
          </div>
        </div>

        <div
          className="mt-4 grid grid-cols-3 gap-2"
          aria-label="Journal performance summary"
        >
          <SummaryMetric label="Trades" value={String(entries.length)} />
          <SummaryMetric
            label="Net P/L"
            value={fmtMoney(summary.net)}
            tone={summary.net >= 0 ? "positive" : "negative"}
          />
          <SummaryMetric
            label="Win rate"
            value={`${summary.winRate.toFixed(0)}%`}
            subvalue={fmtR(summary.averageR)}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <ExportButton
            icon={<Download size={16} />}
            label="Export CSV"
            disabled={entries.length === 0}
            onClick={() => runExport("csv")}
          />
          <ExportButton
            icon={<FileSpreadsheet size={16} />}
            label="Export Excel"
            disabled={entries.length === 0}
            onClick={() => runExport("excel")}
          />
        </div>
      </div>

      {error && (
        <div
          className="shrink-0 border-b border-choch/20 bg-choch/10 px-4 py-2.5 text-xs leading-5 text-choch"
          role="status"
        >
          Backend sync is unavailable. Showing the local journal cache.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {loading && entries.length === 0 && <JournalSkeleton />}

        {!loading && entries.length === 0 && (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border-strong bg-terminal-panel px-6 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
              <NotebookTabs size={24} aria-hidden="true" />
            </div>
            <h3 className="mt-4 text-base font-semibold">No journal entries yet</h3>
            <p className="mt-2 max-w-xs text-sm leading-6 text-ink-muted">
              Closed simulated trades are journaled automatically and will appear
              here with their execution details.
            </p>
          </div>
        )}

        {entries.length > 0 && (
          <div className="space-y-3" role="list" aria-label="Journal entries">
            {entries.map((entry) => (
              <MobileJournalCard
                key={entry.id}
                entry={entry}
                expanded={expandedId === entry.id}
                onToggle={() =>
                  setExpandedId((current) => (current === entry.id ? null : entry.id))
                }
                onDelete={(id) => void remove(id)}
                onNotesCommit={(id, notes) => void update(id, { notes })}
                onCapture={(id, phase) => void capture(id, phase)}
                capturing={capturing}
                captureNotice={captureNotice?.entryId === entry.id ? captureNotice : null}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SummaryMetric({
  label,
  value,
  subvalue,
  tone = "neutral",
}: {
  label: string;
  value: string;
  subvalue?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-terminal-border bg-terminal-panel-2 px-3 py-2.5">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1">
        <span
          className={cn(
            "min-w-0 truncate text-sm font-bold tabular",
            tone === "positive" && "text-bull",
            tone === "negative" && "text-bear",
            tone === "neutral" && "text-ink",
          )}
        >
          {value}
        </span>
        {subvalue && <span className="truncate text-[10px] text-ink-faint">{subvalue}</span>}
      </div>
    </div>
  );
}

function ExportButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 items-center justify-center gap-2 rounded-xl border border-terminal-border-strong bg-terminal-panel-2 px-3 text-xs font-semibold text-ink-muted transition-colors hover:border-brand/40 hover:bg-terminal-hover hover:text-brand active:bg-terminal-pressed disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

function MobileJournalCard({
  entry,
  expanded,
  onToggle,
  onDelete,
  onNotesCommit,
  onCapture,
  capturing,
  captureNotice,
}: {
  entry: JournalEntry;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (id: string) => void;
  onNotesCommit: (id: string, notes: string) => void;
  onCapture: (id: string, phase: ScreenshotPhase) => void;
  capturing: string | null;
  captureNotice: CaptureNotice | null;
}) {
  const detailsId = useId();
  const notesId = useId();
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const precision = getMarketSymbol(entry.symbol)?.pricePrecision ?? 2;
  const profitable = entry.pnl >= 0;

  useEffect(() => {
    setNotes(entry.notes ?? "");
  }, [entry.notes]);

  const commitNotes = () => {
    if (notes === (entry.notes ?? "")) return;
    onNotesCommit(entry.id, notes);
    setNotesSaved(true);
    window.setTimeout(() => setNotesSaved(false), 1800);
  };

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-terminal-panel transition-colors",
        expanded ? "border-brand/35 shadow-accent" : "border-terminal-border",
      )}
      role="listitem"
    >
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="flex min-h-[76px] min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-terminal-hover active:bg-terminal-pressed"
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              entry.side === "long"
                ? "bg-bull/10 text-bull"
                : "bg-bear/10 text-bear",
            )}
            aria-hidden="true"
          >
            {entry.side === "long" ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate text-sm font-bold text-ink">{entry.symbol}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                  entry.side === "long"
                    ? "bg-bull/10 text-bull"
                    : "bg-bear/10 text-bear",
                )}
              >
                {entry.side}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs text-ink-muted">
              {fmtDateTime(entry.entryTime)}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span
              className={cn(
                "block text-sm font-bold tabular",
                profitable ? "text-bull" : "text-bear",
              )}
            >
              {fmtMoney(entry.pnl)}
            </span>
            <span className="mt-1 block text-xs font-medium text-ink-muted tabular">
              {fmtR(entry.rr)}
            </span>
          </span>
          <ChevronDown
            size={18}
            aria-hidden="true"
            className={cn(
              "shrink-0 text-ink-faint transition-transform",
              expanded && "rotate-180 text-brand",
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="flex w-11 shrink-0 items-center justify-center border-l border-terminal-border text-ink-faint transition-colors hover:bg-bear/10 hover:text-bear active:bg-bear/15"
          aria-label={`Delete ${entry.symbol} journal entry`}
        >
          <Trash2 size={18} aria-hidden="true" />
        </button>
      </div>

      {confirmDelete && (
        <div
          className="flex items-center gap-2 border-t border-bear/20 bg-bear/10 px-3 py-2"
          role="group"
          aria-label="Confirm delete journal entry"
        >
          <span className="min-w-0 flex-1 text-xs font-medium text-bear">
            Delete this entry permanently?
          </span>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-ink-muted hover:bg-terminal-hover hover:text-ink"
          >
            <X size={15} aria-hidden="true" />
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onDelete(entry.id)}
            className="flex h-11 items-center gap-1.5 rounded-xl bg-bear px-3 text-xs font-semibold text-white hover:brightness-105 active:brightness-95"
          >
            <Trash2 size={15} aria-hidden="true" />
            Delete
          </button>
        </div>
      )}

      {expanded && (
        <div id={detailsId} className="border-t border-terminal-border bg-terminal-panel-2/55 px-3 pb-4 pt-3">
          <dl className="grid grid-cols-2 gap-2">
            <TradeDetail label="Entry" value={fmtPrice(entry.entryPrice, precision)} />
            <TradeDetail label="Exit" value={fmtPrice(entry.exitPrice, precision)} />
            <TradeDetail label="Quantity" value={entry.quantity.toFixed(4)} />
            <TradeDetail label="Risk" value={fmtMoney(entry.riskAmount)} />
            <div className="col-span-2">
              <TradeDetail label="Exit time" value={fmtDateTime(entry.exitTime)} />
            </div>
          </dl>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor={notesId} className="text-xs font-semibold text-ink">
                Notes & rationale
              </label>
              <span className="flex min-h-5 items-center gap-1 text-[10px] text-bull" aria-live="polite">
                {notesSaved && (
                  <>
                    <Check size={12} aria-hidden="true" /> Saved
                  </>
                )}
              </span>
            </div>
            <textarea
              id={notesId}
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value);
                setNotesSaved(false);
              }}
              onBlur={commitNotes}
              placeholder="What was the setup, thesis and lesson?"
              className="min-h-24 w-full resize-y rounded-xl border border-terminal-border-strong bg-terminal-bg px-3 py-2.5 text-base leading-6 text-ink outline-hidden transition-colors placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <p className="mt-1 text-[10px] leading-4 text-ink-faint">
              Notes save when you leave this field.
            </p>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <Camera size={15} className="text-brand" aria-hidden="true" />
              <h3 className="text-xs font-semibold text-ink">Chart captures</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {PHASES.map(({ phase, label }) => {
                const captureKey = `${entry.id}:${phase}`;
                const isCapturing = capturing === captureKey;
                return (
                  <button
                    key={phase}
                    type="button"
                    disabled={capturing !== null}
                    onClick={() => onCapture(entry.id, phase)}
                    className="flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] font-semibold text-ink-muted transition-colors hover:border-brand/40 hover:bg-terminal-hover hover:text-brand active:bg-terminal-pressed disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {isCapturing ? (
                      <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden="true" />
                    ) : (
                      <Camera size={14} className="shrink-0" aria-hidden="true" />
                    )}
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>

            {captureNotice && (
              <p
                className={cn(
                  "mt-2 text-xs leading-5",
                  captureNotice.tone === "success" ? "text-bull" : "text-bear",
                )}
                role={captureNotice.tone === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {captureNotice.message}
              </p>
            )}

            {entry.screenshots && entry.screenshots.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {entry.screenshots.map((screenshot) => (
                  <a
                    key={screenshot.id}
                    href={screenshot.thumb || undefined}
                    target={screenshot.thumb ? "_blank" : undefined}
                    rel={screenshot.thumb ? "noreferrer" : undefined}
                    className={cn(
                      "relative min-h-24 overflow-hidden rounded-xl border border-terminal-border bg-terminal-bg focus-ring",
                      !screenshot.thumb && "pointer-events-none",
                    )}
                    aria-label={`${screenshot.phase} chart capture`}
                  >
                    {screenshot.thumb ? (
                      <img
                        src={screenshot.thumb}
                        alt={`${entry.symbol} ${screenshot.phase} chart`}
                        className="aspect-video h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex min-h-24 flex-col items-center justify-center gap-2 px-2 text-center text-[10px] text-ink-faint">
                        <ImageIcon size={18} aria-hidden="true" />
                        Preview unavailable
                      </span>
                    )}
                    <span className="absolute bottom-1.5 left-1.5 rounded-md bg-terminal-bg/90 px-1.5 py-1 text-[9px] font-semibold uppercase tracking-wide text-ink">
                      {screenshot.phase.replaceAll("-", " ")}
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="mt-3 flex min-h-20 items-center justify-center rounded-xl border border-dashed border-terminal-border px-4 text-center text-xs text-ink-faint">
                Add a chart capture to preserve visual context.
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function TradeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-terminal-border bg-terminal-bg px-3 py-2.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </dt>
      <dd className="mt-1 truncate text-xs font-semibold text-ink tabular">{value}</dd>
    </div>
  );
}

function JournalSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading journal" aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex min-h-[76px] animate-pulse items-center gap-3 rounded-2xl border border-terminal-border bg-terminal-panel px-3"
        >
          <div className="h-10 w-10 rounded-xl bg-terminal-panel-3" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-24 rounded-sm bg-terminal-panel-3" />
            <div className="h-2.5 w-36 rounded-sm bg-terminal-panel-3" />
          </div>
          <div className="h-4 w-16 rounded-sm bg-terminal-panel-3" />
        </div>
      ))}
    </div>
  );
}
