"use client";
/**
 * Toaster (Phase 2) — fixed top-right stack of transient toasts from
 * `toastStore`. Each toast auto-dismisses after its `duration`; hovering is not
 * required. Responsive: on narrow screens it spans the width near the top.
 * Mounted once at the terminal root.
 */
import { useEffect } from "react";
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  X,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  toastsAtom,
  dismissToastAtom,
  type Toast,
  type ToastVariant,
} from "@/store/toastStore";
import { cn } from "@/utils/cn";

const VARIANT_META: Record<
  ToastVariant,
  { icon: React.ReactNode; accent: string }
> = {
  alert: { icon: <Bell size={16} />, accent: "var(--choch)" },
  success: { icon: <CheckCircle2 size={16} />, accent: "var(--bull)" },
  warn: { icon: <AlertTriangle size={16} />, accent: "var(--choch)" },
  error: { icon: <XCircle size={16} />, accent: "var(--bear)" },
  info: { icon: <Info size={16} />, accent: "var(--accent)" },
};

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useSetAtom(dismissToastAtom);
  const meta = VARIANT_META[toast.variant];

  useEffect(() => {
    if (toast.duration <= 0) return;
    const t = setTimeout(() => dismiss(toast.id), toast.duration);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration, dismiss]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex w-full items-start gap-2.5 rounded-md border border-terminal-border bg-terminal-panel-2 p-3 shadow-lg animate-[toastIn_160ms_ease-out]"
      style={{ borderLeftColor: meta.accent, borderLeftWidth: 3 }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: meta.accent }}>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-ink">{toast.title}</div>
        {toast.message && (
          <div className="mt-0.5 break-words text-2xs text-ink-muted">
            {toast.message}
          </div>
        )}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        className="shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:bg-terminal-hover hover:text-ink"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useAtomValue(toastsAtom);
  if (toasts.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none fixed right-3 top-3 z-[100] flex w-[320px] max-w-[calc(100vw-1.5rem)] flex-col gap-2",
      )}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
