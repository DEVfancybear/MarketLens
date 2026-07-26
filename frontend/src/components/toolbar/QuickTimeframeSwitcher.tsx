"use client";

import { Clock3, CornerDownLeft, X } from "lucide-react";
import { useSetAtom } from "jotai";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { setTimeframeAtom } from "@/store/chartStore";
import { resolveTimeframeShortcut } from "./timeframeSelectorModel";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        "input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']",
      ),
    )
  );
}

/**
 * TradingView-style interval entry: start typing a number from anywhere in the
 * chart workspace, or press comma to open an empty interval prompt.
 */
export function QuickTimeframeSwitcher() {
  const setTimeframe = useSetAtom(setTimeframeAtom);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const resolved = resolveTimeframeShortcut(value);

  const close = useCallback(() => {
    setOpen(false);
    setValue("");
  }, []);

  const apply = useCallback(() => {
    const timeframe = resolveTimeframeShortcut(value);
    if (!timeframe) return;
    setTimeframe(timeframe);
    close();
  }, [close, setTimeframe, value]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        document.querySelector("[aria-modal='true']")
      ) {
        return;
      }

      const isDigit = /^[0-9]$/.test(event.key);
      if (!isDigit && event.key !== ",") return;

      event.preventDefault();
      setValue(isDigit ? event.key : "");
      setOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) return null;

  const hasValue = value.trim().length > 0;
  const status = resolved
    ? `Switch to ${resolved}`
    : hasValue
      ? "This interval is not available"
      : "Try 1, 5, 15, 1H, 1D, 1W or 1M";

  return createPortal(
    <div
      data-chart-ui
      data-quick-timeframe-switcher
      role="dialog"
      aria-modal="false"
      aria-labelledby="quick-timeframe-title"
      className="fixed left-1/2 top-[72px] z-[950] w-[min(360px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised text-ink shadow-floating"
    >
      <div className="flex items-center gap-3 border-b border-terminal-border px-4 py-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
          <Clock3 size={18} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div
            id="quick-timeframe-title"
            className="text-sm font-semibold text-ink"
          >
            Change interval
          </div>
          <div className="text-[11px] text-ink-faint">
            Number alone means minutes
          </div>
        </div>
        <button
          type="button"
          aria-label="Close interval switcher"
          onClick={close}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-2 rounded-xl border border-terminal-border-strong bg-terminal-panel p-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
          <input
            ref={inputRef}
            value={value}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            aria-label="Chart interval"
            aria-describedby="quick-timeframe-status"
            placeholder="Enter interval"
            maxLength={5}
            onChange={(event) => {
              setValue(event.target.value.replace(/[^0-9mMhHdDwW]/g, ""));
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            className="h-9 min-w-0 flex-1 bg-transparent px-2 text-base font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-faint"
          />
          <button
            type="button"
            disabled={!resolved}
            aria-label={resolved ? `Switch to ${resolved}` : "Enter a supported interval"}
            onClick={apply}
            className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-brand px-2.5 text-[var(--accent-contrast)] transition-colors hover:bg-brand-hover disabled:cursor-default disabled:bg-terminal-hover disabled:text-ink-faint"
          >
            <CornerDownLeft size={16} aria-hidden="true" />
          </button>
        </div>
        <div
          id="quick-timeframe-status"
          role="status"
          aria-live="polite"
          className={`mt-2 px-1 text-xs ${
            hasValue && !resolved ? "text-[var(--bear)]" : "text-ink-muted"
          }`}
        >
          {status}
        </div>
      </div>
    </div>,
    document.body,
  );
}
