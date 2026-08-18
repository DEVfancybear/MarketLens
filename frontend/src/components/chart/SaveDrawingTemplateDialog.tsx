"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import type { DrawingTemplate } from "@/types";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { cn } from "@/utils/cn";

interface SaveDrawingTemplateDialogProps {
  open: boolean;
  templates: DrawingTemplate[];
  onCloseAction: () => void;
  onSaveAction: (name: string) => void;
}

export function SaveDrawingTemplateDialog({
  open,
  templates,
  onCloseAction,
  onSaveAction,
}: SaveDrawingTemplateDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  const templateNames = useMemo(
    () =>
      [...new Set(templates.map((template) => template.name))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [templates],
  );
  const trimmed = name.trim();

  useEffect(() => {
    if (!open) return;
    setName("");
    setListOpen(false);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseAction();
      }
      if (event.key === "Enter" && trimmed) {
        event.preventDefault();
        onSaveAction(trimmed);
        onCloseAction();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCloseAction, onSaveAction, open, trimmed]);

  if (!open || typeof document === "undefined") return null;

  const save = () => {
    if (!trimmed) return;
    onSaveAction(trimmed);
    onCloseAction();
  };

  return createPortal(
    <div
      data-chart-ui
      className="platform-dialog-overlay fixed inset-0 z-1300 flex items-end justify-center bg-(--scrim) p-3 backdrop-blur-xs sm:items-center"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCloseAction();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-drawing-template-title"
        ref={dialogRef}
        style={dialogStyle}
        className="platform-dialog relative w-[480px] max-w-[calc(100vw-24px)] rounded-2xl border border-terminal-border-strong bg-terminal-raised px-8 pb-8 pt-9 text-ink shadow-floating"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onCloseAction}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink"
        >
          <X size={22} strokeWidth={1.7} />
        </button>

        <h2
          id="save-drawing-template-title"
          {...dragHandleProps}
          className={cn(
            "mb-5 text-xl font-semibold tracking-[-0.02em] text-ink",
            dragHandleClassName,
          )}
        >
          Save drawing template
        </h2>

        <label
          htmlFor="save-drawing-template-name"
          className="mb-1.5 block text-sm font-medium text-ink-muted"
        >
          New template name
        </label>
        <div className="relative">
          <input
            id="save-drawing-template-name"
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 pr-11 text-sm text-ink outline-hidden placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/15"
            spellCheck={false}
          />
          <button
            type="button"
            aria-label="Show saved templates"
            title="Show saved templates"
            onClick={() => setListOpen((value) => !value)}
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-r-xl text-ink-muted hover:text-ink"
          >
            <ChevronDown
              size={16}
              className={cn(
                "transition-transform",
                listOpen && "rotate-180",
              )}
            />
          </button>

          {listOpen && (
            <div className="mobile-popover absolute left-0 right-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-xl border border-terminal-border-strong bg-terminal-raised p-1.5 shadow-floating">
              {templateNames.length === 0 ? (
                <div className="px-3 py-2 text-xs text-ink-faint">
                  No saved templates
                </div>
              ) : (
                templateNames.map((templateName) => (
                  <button
                    key={templateName}
                    type="button"
                    onClick={() => {
                      setName(templateName);
                      setListOpen(false);
                      inputRef.current?.focus();
                    }}
                    className={cn(
                      "flex min-h-10 w-full items-center rounded-lg px-3 py-1.5 text-left text-sm hover:bg-terminal-hover",
                      templateName === trimmed
                        ? "bg-brand/10 text-brand"
                        : "text-ink",
                    )}
                  >
                    <span className="truncate">{templateName}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCloseAction}
            className="min-h-11 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={save}
            className={cn(
              "min-h-11 rounded-xl px-4 text-sm font-semibold",
              trimmed
                ? "bg-brand text-(--accent-contrast) hover:bg-brand-hover"
                : "cursor-default bg-terminal-hover text-ink-faint",
            )}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
