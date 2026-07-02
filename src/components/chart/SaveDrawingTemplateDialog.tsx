"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, X } from "lucide-react";
import type { DrawingTemplate } from "@/types";
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
      className="fixed inset-0 z-[1300] flex items-start justify-center bg-black/20 pt-8"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCloseAction();
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        className="relative w-[480px] max-w-[calc(100vw-32px)] rounded-md bg-[#1f1f1f] px-10 pb-9 pt-10 text-ink shadow-2xl shadow-black/60"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onCloseAction}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded text-[#b2b5be] hover:bg-white/10 hover:text-white"
        >
          <X size={22} strokeWidth={1.7} />
        </button>

        <h2 className="mb-5 text-xl font-semibold text-[#f0f3fa]">
          Save drawing template
        </h2>

        <label className="mb-1.5 block text-sm text-[#9aa0aa]">
          New template name
        </label>
        <div className="relative">
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-full rounded border border-[#2962ff] bg-transparent px-2.5 pr-9 text-sm text-[#f0f3fa] outline-none placeholder:text-[#5d606b]"
            spellCheck={false}
          />
          <button
            type="button"
            aria-label="Show saved templates"
            title="Show saved templates"
            onClick={() => setListOpen((value) => !value)}
            className="absolute right-0 top-0 flex h-8 w-8 items-center justify-center rounded-r text-[#9aa0aa] hover:text-white"
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
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-44 overflow-y-auto rounded-md border border-[#4b4f58] bg-[#2a2a2a] py-1 shadow-2xl shadow-black/60">
              {templateNames.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[#787b86]">
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
                      "flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-[#3a3a3a]",
                      templateName === trimmed
                        ? "text-[#2962ff]"
                        : "text-[#f0f3fa]",
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
            className="h-9 rounded border border-[#5d606b] px-4 text-sm font-medium text-[#f0f3fa] hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!trimmed}
            onClick={save}
            className={cn(
              "h-9 rounded px-4 text-sm font-medium",
              trimmed
                ? "bg-[#2962ff] text-white hover:bg-[#1e53e5]"
                : "cursor-default bg-[#3a3a3a] text-[#5d606b]",
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
