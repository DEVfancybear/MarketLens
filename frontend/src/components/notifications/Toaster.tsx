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
      role={toast.variant === "error" ? "alert" : "status"}
      data-chart-ui
      data-toast
      className="pointer-events-none flex w-full items-start gap-3 rounded-xl border border-terminal-border bg-terminal-raised/95 p-3.5 shadow-floating backdrop-blur-xl animate-[toastIn_160ms_ease-out]"
      style={{ borderLeftColor: meta.accent, borderLeftWidth: 3 }}
    >
      <span className="mt-0.5 shrink-0" style={{ color: meta.accent }}>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div data-toast-title className="text-[13px] font-semibold text-ink">{toast.title}</div>
        {toast.message && (
          <div data-toast-message className="mt-1 break-words text-xs leading-5 text-ink-muted">
            {toast.message}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="toast-close pointer-events-auto shrink-0 rounded-lg text-ink-faint transition-colors hover:bg-terminal-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
      role="region"
      aria-label="Notifications"
      className={cn(
        "toast-stack pointer-events-none fixed z-[1400] flex w-[356px] max-w-[calc(100vw-1.5rem)] flex-col gap-2.5",
      )}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}
