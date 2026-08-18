"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";

export type PlatformPromptOptions = {
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type PlatformConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

export type PlatformContentDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "medium" | "large";
  closeLabel?: string;
};

export function PlatformContentDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "medium",
  closeLabel = "Close",
}: PlatformContentDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useDialogLifecycle(onClose, closeRef, dialogRef, open);

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      className="platform-dialog-overlay fixed inset-0 z-1400 flex items-end justify-center bg-(--scrim) p-3 backdrop-blur-xs sm:items-center"
      data-chart-ui
      data-platform-dialog
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={cn(
          "platform-dialog flex max-h-[calc(100dvh-24px)] w-full max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised text-ink shadow-floating",
          size === "large" ? "sm:w-[780px]" : "sm:w-[520px]",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          data-dialog-header
          className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-terminal-border px-4 sm:px-5"
        >
          <div className="min-w-0 py-3">
            <h2
              id={titleId}
              className="text-lg font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-xl"
            >
              {title}
            </h2>
            {description && (
              <p
                id={descriptionId}
                className="mt-1 text-[11px] leading-4 text-ink-muted sm:text-xs"
              >
                {description}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink focus-ring"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X size={20} />
          </button>
        </div>
        <div
          data-dialog-body
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5"
        >
          {children}
        </div>
        {footer && (
          <div
            data-dialog-footer
            className="flex shrink-0 justify-end gap-2 border-t border-terminal-border px-4 py-3 sm:px-5"
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

type PromptRequest = {
  kind: "prompt";
  id: number;
  options: PlatformPromptOptions;
  resolve: (value: string | null) => void;
};

type ConfirmRequest = {
  kind: "confirm";
  id: number;
  options: PlatformConfirmOptions;
  resolve: (value: boolean) => void;
};

type DialogRequest = PromptRequest | ConfirmRequest;

function cancelDialogRequest(request: DialogRequest) {
  if (request.kind === "prompt") request.resolve(null);
  else request.resolve(false);
}

/**
 * Small promise-based bridge for places where an action used to call the
 * browser's synchronous prompt/confirm APIs. Each consumer renders the
 * returned `dialog` next to its own UI, while the actual dialog markup and
 * responsive behavior stay shared between desktop and mobile.
 */
export function usePlatformDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const requestRef = useRef<DialogRequest | null>(null);
  const nextIdRef = useRef(0);

  const replaceRequest = useCallback((next: DialogRequest) => {
    const previous = requestRef.current;
    if (previous) cancelDialogRequest(previous);
    requestRef.current = next;
    setRequest(next);
  }, []);

  const settle = useCallback((value: string | null | boolean) => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    setRequest(null);
    if (current.kind === "prompt") current.resolve(typeof value === "string" ? value : null);
    else current.resolve(value === true);
  }, []);

  useEffect(() => () => {
    const current = requestRef.current;
    requestRef.current = null;
    if (current) cancelDialogRequest(current);
  }, []);

  const prompt = useCallback((options: PlatformPromptOptions) => {
    return new Promise<string | null>((resolve) => {
      replaceRequest({
        kind: "prompt",
        id: ++nextIdRef.current,
        options,
        resolve,
      });
    });
  }, [replaceRequest]);

  const confirm = useCallback((options: PlatformConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      replaceRequest({
        kind: "confirm",
        id: ++nextIdRef.current,
        options,
        resolve,
      });
    });
  }, [replaceRequest]);

  return {
    requestPrompt: prompt,
    requestConfirm: confirm,
    dialog: <PlatformDialogHost request={request} onResolve={settle} />,
  };
}

function PlatformDialogHost({
  request,
  onResolve,
}: {
  request: DialogRequest | null;
  onResolve: (value: string | null | boolean) => void;
}) {
  if (typeof document === "undefined" || !request) return null;

  return createPortal(
    <div
      className="platform-dialog-overlay fixed inset-0 z-1400 flex items-end justify-center bg-(--scrim) p-3 backdrop-blur-xs sm:items-center"
      data-chart-ui
      data-platform-dialog
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onResolve(request.kind === "prompt" ? null : false);
        }
      }}
    >
      {request.kind === "prompt" ? (
        <PlatformPromptDialog key={request.id} options={request.options} onCancel={() => onResolve(null)} onConfirm={(value) => onResolve(value)} />
      ) : (
        <PlatformConfirmDialog key={request.id} options={request.options} onCancel={() => onResolve(false)} onConfirm={() => onResolve(true)} />
      )}
    </div>,
    document.body,
  );
}

function PlatformPromptDialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: PlatformPromptOptions;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(options.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useDialogLifecycle(onCancel, inputRef, dialogRef);

  return (
    <div
      ref={dialogRef}
      className="platform-dialog flex w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised text-ink shadow-floating"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={options.description ? descriptionId : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div data-dialog-header className="flex min-h-16 items-center justify-between border-b border-terminal-border px-5">
        <h2 id={titleId} className="text-xl font-semibold leading-none tracking-[-0.02em] text-ink">{options.title}</h2>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink focus-ring" onClick={onCancel} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div data-dialog-body className="min-h-[120px] space-y-3 overflow-y-auto px-5 py-5">
        {options.description && <p id={descriptionId} className="text-sm leading-5 text-ink-muted">{options.description}</p>}
        <label htmlFor={`${titleId}-input`} className="block text-[13px] font-semibold text-ink-muted">{options.label ?? "Value"}</label>
        <input
          ref={inputRef}
          id={`${titleId}-input`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm(value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder={options.placeholder}
          className="h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 text-sm font-medium text-ink outline-hidden selection:bg-brand selection:text-(--accent-contrast) focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
      </div>
      <DialogFooter cancelLabel={options.cancelLabel} confirmLabel={options.confirmLabel} onCancel={onCancel} onConfirm={() => onConfirm(value)} />
    </div>
  );
}

function PlatformConfirmDialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: PlatformConfirmOptions;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useDialogLifecycle(
    onCancel,
    options.tone === "danger" ? cancelRef : confirmRef,
    dialogRef,
  );

  return (
    <div
      ref={dialogRef}
      className="platform-dialog flex w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised text-ink shadow-floating"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={options.description ? descriptionId : undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div data-dialog-header className="flex min-h-16 items-center justify-between border-b border-terminal-border px-5">
        <h2 id={titleId} className="text-xl font-semibold leading-none tracking-[-0.02em] text-ink">{options.title}</h2>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink focus-ring" onClick={onCancel} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      <div data-dialog-body className="min-h-[96px] space-y-3 overflow-y-auto px-5 py-5">
        {options.description && <p id={descriptionId} className="text-sm leading-5 text-ink-muted">{options.description}</p>}
      </div>
      <div data-dialog-footer className="flex justify-end gap-2 border-t border-terminal-border px-5 py-3">
        <button ref={cancelRef} type="button" onClick={onCancel} className="min-h-10 rounded-xl border border-terminal-border-strong bg-transparent px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-terminal-hover focus-ring">{options.cancelLabel ?? "Cancel"}</button>
        <button ref={confirmRef} type="button" onClick={onConfirm} className={cn("min-h-10 rounded-xl border px-4 text-sm font-semibold transition-colors focus-ring", options.tone === "danger" ? "border-bear bg-bear text-white hover:bg-bear/90" : "border-brand bg-brand text-(--accent-contrast) hover:bg-brand-hover")}>{options.confirmLabel ?? "Ok"}</button>
      </div>
    </div>
  );
}

function DialogFooter({
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  cancelLabel?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div data-dialog-footer className="flex justify-end gap-2 border-t border-terminal-border px-5 py-3">
      <button type="button" onClick={onCancel} className="min-h-10 rounded-xl border border-terminal-border-strong bg-transparent px-3.5 text-sm font-semibold text-ink transition-colors hover:bg-terminal-hover focus-ring">{cancelLabel ?? "Cancel"}</button>
      <button type="button" onClick={onConfirm} className="min-h-10 rounded-xl border border-brand bg-brand px-4 text-sm font-semibold text-(--accent-contrast) transition-colors hover:bg-brand-hover focus-ring">{confirmLabel ?? "Ok"}</button>
    </div>
  );
}

function useDialogLifecycle(
  onCancel: () => void,
  focusRef: RefObject<HTMLElement | null>,
  dialogRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  useEffect(() => {
    if (!enabled) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focus = () => {
      const element = focusRef?.current;
      if (element instanceof HTMLInputElement) element.select();
      else element?.focus();
    };
    const focusFrame = requestAnimationFrame(focus);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelRef.current();
      } else if (event.key === "Tab") {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus();
    };
  }, [dialogRef, enabled, focusRef]);
}
