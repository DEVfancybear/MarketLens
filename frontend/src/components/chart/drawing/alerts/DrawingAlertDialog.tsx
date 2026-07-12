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
  const targets = useMemo(() => drawing ? drawingAlertTargets(drawing) : [], [drawing]);
  const quote = useQuote(symbol);
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
    createAlert({
      symbol,
      condition,
      price: target.price,
      recurring,
      note: note.trim() || `${drawing.name ?? drawing.tool} · ${target.label}`,
      source: drawingAlertSnapshot(drawing, target),
    });
    close(null);
    showAlerts(true);
  };

  return createPortal(
    <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/50 p-4" onClick={() => close(null)}>
      <div role="dialog" aria-label="Create drawing alert" className="w-full max-w-[390px] rounded-lg border border-terminal-border bg-terminal-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-11 items-center gap-2 border-b border-terminal-border px-3">
          <Bell size={16} className="text-brand" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">Alert on {drawing.name ?? drawing.tool}</span>
          <button type="button" aria-label="Close drawing alert" onClick={() => close(null)} className="rounded p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"><X size={16} /></button>
        </div>
        <div className="space-y-3 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-ink-faint">Drawing target</span>
            <select aria-label="Drawing alert target" value={target.id} onChange={(event) => { const next = targets.find((candidate) => candidate.id === event.target.value); setTargetId(event.target.value); if (next) setCondition(inferCondition(next.price, quote?.last)); }} className="h-9 rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-ink outline-none focus:border-brand">
              {targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.price}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-1">
            {CONDITIONS.map((candidate) => (
              <button key={candidate} type="button" aria-pressed={condition === candidate} onClick={() => setCondition(candidate)} className={cn("rounded border px-2 py-1.5 text-2xs", condition === candidate ? "border-brand/40 bg-brand/15 text-brand" : "border-terminal-border text-ink-muted hover:bg-terminal-hover")}>
                {CONDITION_SYMBOL[candidate]} {CONDITION_LABEL[candidate]}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-ink-faint">Message (optional)</span>
            <input aria-label="Drawing alert message" value={note} onChange={(event) => setNote(event.target.value)} className="h-9 rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-ink outline-none focus:border-brand" />
          </label>
          <button type="button" aria-pressed={recurring} onClick={() => setRecurring((value) => !value)} className={cn("rounded border px-2 py-1.5 text-2xs", recurring ? "border-brand/40 bg-brand/15 text-brand" : "border-terminal-border text-ink-muted")}>{recurring ? "Every time" : "Only once"}</button>
          <p className="text-[10px] leading-4 text-ink-faint">The target price is snapshotted now. Moving or deleting the drawing will not change this alert.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-terminal-border px-3 py-2">
          <button type="button" onClick={() => close(null)} className="rounded px-3 py-1.5 text-xs text-ink-muted hover:bg-terminal-hover">Cancel</button>
          <button type="button" onClick={submit} className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/85">Create alert</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
