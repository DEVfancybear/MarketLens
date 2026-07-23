"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAtomValue, useSetAtom } from "jotai";
import { Bell, X } from "lucide-react";
import { drawingsAtom, symbolAtom } from "@/store/chartStore";
import {
  CONDITION_LABEL,
  CONDITION_SYMBOL,
  useAlertStore,
  type AlertCondition,
} from "@/store/alertStore";
import { setAlertCenterAtom } from "@/store/uiStore";
import { useQuote } from "@/hooks/useQuote";
import { inferCondition } from "@/services/alertEngine";
import { cn } from "@/utils/cn";
import {
  drawingAlertSnapshot,
  drawingAlertTargets,
} from "./drawingAlertCapabilities";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import {
  drawingAlertDrawingIdAtom,
  setDrawingAlertDrawingIdAtom,
} from "./drawingAlertUiState";

const CONDITIONS: AlertCondition[] = ["above", "below", "crossUp", "crossDown"];

export function DrawingAlertDialog() {
  const drawingId = useAtomValue(drawingAlertDrawingIdAtom);
  const drawings = useAtomValue(drawingsAtom);
  const symbol = useAtomValue(symbolAtom);
  const drawing = drawings.find((candidate) => candidate.id === drawingId) ?? null;
  const quote = useQuote(symbol);
  const targets = useMemo(
    () => drawing ? drawingAlertTargets(drawing, quote?.timestamp ?? Date.now()) : [],
    [drawing, quote?.timestamp],
  );
  const createAlert = useAlertStore((state) => state.createAlert);
  const close = useSetAtom(setDrawingAlertDrawingIdAtom);
  const showAlerts = useSetAtom(setAlertCenterAtom);
  const [targetId, setTargetId] = useState("");
  const [condition, setCondition] = useState<AlertCondition>("crossUp");
  const [recurring, setRecurring] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const target = targets[0];
    setTargetId(target?.id ?? "");
    setCondition(target ? inferCondition(target.price, quote?.last) : "crossUp");
    setRecurring(false);
    setNote("");
  }, [drawingId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!drawingId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, drawingId]);

  if (typeof document === "undefined" || !drawingId || !drawing || targets.length === 0) {
    return null;
  }
  const target = targets.find((candidate) => candidate.id === targetId) ?? targets[0];
  const submit = () => {
    if (!Number.isFinite(target.price) || target.price <= 0) {
      reportFrontendError(
        new Error("The drawing target does not have a valid price."),
        {
          title: "Alert not created",
          logPrefix: "Drawing alert has invalid target price",
        },
      );
      return;
    }
    try {
      createAlert({
        symbol,
        condition,
        price: target.price,
        recurring,
        note: note.trim() || `${drawing.name ?? drawing.tool} · ${target.label}`,
        source: drawingAlertSnapshot(drawing, target),
        ...(target.technicalTarget ? { technicalTarget: target.technicalTarget } : {}),
      });
    } catch (error) {
      reportFrontendError(error, {
        title: "Alert not created",
        logPrefix: "Drawing alert validation failed",
      });
      return;
    }
    close(null);
    showAlerts(true);
  };

  return createPortal(
    <div data-chart-ui className="platform-dialog-overlay fixed inset-0 z-[1350] flex items-end justify-center bg-[var(--scrim)] p-3 backdrop-blur-sm sm:items-center" onClick={() => close(null)}>
      <div role="dialog" aria-modal="true" aria-label="Create drawing alert" className="platform-dialog w-full max-w-[420px] rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating" onClick={(event) => event.stopPropagation()}>
        <div data-dialog-header className="flex min-h-14 items-center gap-2 border-b border-terminal-border px-4">
          <Bell size={16} className="text-brand" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">Alert on {drawing.name ?? drawing.tool}</span>
          <button type="button" aria-label="Close drawing alert" onClick={() => close(null)} className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink"><X size={18} /></button>
        </div>
        <div data-dialog-body className="space-y-3 overflow-y-auto p-3">
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-ink-faint">Drawing target</span>
            <select aria-label="Drawing alert target" value={target.id} onChange={(event) => { const next = targets.find((candidate) => candidate.id === event.target.value); setTargetId(event.target.value); if (next) setCondition(inferCondition(next.price, quote?.last)); }} className="h-10 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15">
              {targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.price}</option>)}
            </select>
          </label>
          {target.technicalTarget?.kind === "dynamic-channel" ? (
            <div className="rounded-lg border border-terminal-border bg-terminal-bg px-2.5 py-2 text-2xs text-ink-muted">
              Channel operator: <span className="font-medium text-ink">{target.label}</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {CONDITIONS.map((candidate) => (
                <button key={candidate} type="button" aria-pressed={condition === candidate} onClick={() => setCondition(candidate)} className={cn("rounded border px-2 py-1.5 text-2xs", condition === candidate ? "border-brand/40 bg-brand/15 text-brand" : "border-terminal-border text-ink-muted hover:bg-terminal-hover")}>
                  {CONDITION_SYMBOL[candidate]} {CONDITION_LABEL[candidate]}
                </button>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-ink-faint">Message (optional)</span>
            <input aria-label="Drawing alert message" value={note} onChange={(event) => setNote(event.target.value)} className="h-10 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
          </label>
          <button type="button" aria-pressed={recurring} onClick={() => setRecurring((value) => !value)} className={cn("rounded border px-2 py-1.5 text-2xs", recurring ? "border-brand/40 bg-brand/15 text-brand" : "border-terminal-border text-ink-muted")}>{recurring ? "Every time" : "Only once"}</button>
          <p className="text-[10px] leading-4 text-ink-faint">{target.technicalTarget?.kind === "dynamic-line" || target.technicalTarget?.kind === "dynamic-channel" ? "The drawing geometry is snapshotted now and evaluated at each market timestamp." : "The target price is snapshotted now. Moving or deleting the drawing will not change this alert."}</p>
        </div>
        <div data-dialog-footer className="flex justify-end gap-2 border-t border-terminal-border px-3 py-2">
          <button type="button" onClick={() => close(null)} className="min-h-10 rounded-xl border border-terminal-border-strong px-3 text-xs font-semibold text-ink-muted hover:bg-terminal-hover">Cancel</button>
          <button type="button" onClick={submit} className="min-h-10 rounded-xl bg-brand px-4 text-xs font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover">Create alert</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
