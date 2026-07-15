"use client";

import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Plus, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "@/components/ui/Dropdown";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { useTimeframeFavorites } from "@/hooks/useTimeframeFavorites";
import type { Timeframe } from "@/types";
import { cn } from "@/utils/cn";
import {
  CUSTOM_INTERVAL_TYPES,
  type CustomIntervalType,
  TIMEFRAME_MENU_GROUPS,
  customIntervalToTimeframe,
  timeframeShortLabel,
  visibleToolbarTimeframes,
} from "./timeframeSelectorModel";

export function TimeframeSelector({
  timeframe,
  onChange,
}: {
  timeframe: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}) {
  const { favorites, toggleFavorite, addFavorite } = useTimeframeFavorites();
  const [customOpen, setCustomOpen] = useState(false);

  const visible = useMemo(
    () => visibleToolbarTimeframes(favorites, timeframe),
    [favorites, timeframe],
  );

  return (
    <div className="flex items-center gap-0.5">
      {visible.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={cn(
            "h-8 min-w-[30px] rounded-lg px-2 text-[11px] font-semibold transition-colors",
            tf === timeframe
              ? "bg-brand/15 text-brand shadow-[inset_0_0_0_1px_rgb(var(--accent-rgb)/.18)]"
              : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
          )}
        >
          {timeframeShortLabel(tf)}
        </button>
      ))}

      <Dropdown
        width={236}
        trigger={(open) => (
          <button
            type="button"
            aria-label="Select interval"
            title="Select interval"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink",
              open && "bg-brand/10 text-brand",
            )}
          >
            <ChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-[min(640px,calc(100vh-72px))] overflow-y-auto bg-terminal-raised py-1 text-[13px] font-semibold text-ink">
            <button
              type="button"
              onClick={() => {
                close();
                setCustomOpen(true);
              }}
              className="flex h-11 w-full items-center gap-2 border-b border-terminal-border px-3 text-left text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
            >
              <Plus size={18} className="text-brand" />
              <span>Add custom interval...</span>
            </button>

            {TIMEFRAME_MENU_GROUPS.map((group) => (
              <div key={group.label} className="border-b border-terminal-border py-2">
                <div className="mb-1 flex h-6 items-center justify-between px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <span>{group.label}</span>
                  <ChevronUp size={14} />
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const supported = Boolean(item.timeframe);
                    const active = item.timeframe === timeframe;
                    const favorite =
                      item.timeframe != null &&
                      favorites.includes(item.timeframe);

                    return (
                      <button
                        key={`${group.label}:${item.label}`}
                        type="button"
                        disabled={!supported}
                        onClick={() => {
                          if (!item.timeframe) return;
                          onChange(item.timeframe);
                          close();
                        }}
                        className={cn(
                          "group flex h-8 w-full items-center gap-2 px-3 text-left transition-colors",
                          active
                            ? "bg-brand/15 text-brand"
                            : supported
                              ? "text-ink-muted hover:bg-terminal-hover hover:text-ink"
                              : "cursor-default text-ink-faint opacity-55",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {item.label}
                        </span>
                        {item.timeframe && (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={
                              favorite
                                ? "Remove from favorite intervals"
                                : "Add to favorite intervals"
                            }
                            title={
                              favorite
                                ? "Remove from favorite intervals"
                                : "Add to favorite intervals"
                            }
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              toggleFavorite(item.timeframe!);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") {
                                return;
                              }
                              event.preventDefault();
                              event.stopPropagation();
                              toggleFavorite(item.timeframe!);
                            }}
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm",
                              active
                                ? favorite
                                  ? "text-[var(--accent-contrast)]"
                                  : "text-[var(--accent-contrast)]/60"
                                : favorite
                                  ? "text-ink"
                                  : "text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100",
                            )}
                          >
                            <Star
                              size={16}
                              fill={favorite ? "currentColor" : "none"}
                            />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Dropdown>

      {customOpen && (
        <CustomIntervalDialog
          onClose={() => setCustomOpen(false)}
          onAdd={(nextTimeframe) => {
            addFavorite(nextTimeframe);
            onChange(nextTimeframe);
            setCustomOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CustomIntervalDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (timeframe: Timeframe) => void;
}) {
  const [type, setType] = useState<CustomIntervalType>("minutes");
  const [typeOpen, setTypeOpen] = useState(false);
  const [interval, setInterval] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const resolved = customIntervalToTimeframe(type, interval);
  const initialPosition = useCallback(
    () => ({
      left: Math.min(48, window.innerWidth * 0.04),
      top: Math.min(96, window.innerHeight * 0.12),
    }),
    [],
  );
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog({
      initialPosition,
      boundsMargin: 8,
    });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = () => {
    if (!resolved) return;
    onAdd(resolved);
  };

  return createPortal(
    <div
      data-chart-ui
      className="platform-dialog-overlay fixed inset-0 z-[900] bg-[var(--scrim)] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-interval-title"
        className="platform-dialog fixed w-[420px] max-w-[calc(100vw-24px)] overflow-visible rounded-2xl border border-terminal-border-strong bg-terminal-raised text-ink shadow-floating"
        style={dialogStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          data-dialog-header
          {...dragHandleProps}
          className={cn(
            "flex h-16 items-center justify-between border-b border-terminal-border px-5",
            dragHandleClassName,
          )}
        >
          <div id="custom-interval-title" className="text-xl font-semibold tracking-[-0.02em] text-ink">
            Add custom interval
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-terminal-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            <X size={22} />
          </button>
        </div>

        <div data-dialog-body className="space-y-3 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-[96px_minmax(0,180px)] items-center gap-3">
            <label className="text-sm font-semibold text-ink">
              Type
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setTypeOpen((open) => !open)}
                className={cn(
                  "flex h-10 w-full items-center justify-between rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 text-left text-sm font-semibold text-ink",
                  typeOpen && "border-brand ring-2 ring-brand/15",
                )}
              >
                <span>{type}</span>
                <ChevronDown
                  size={16}
                  className={cn("transition-transform", typeOpen && "rotate-180")}
                />
              </button>
              {typeOpen && (
                <div className="mobile-popover absolute left-0 top-[44px] z-[95] min-w-[132px] overflow-hidden rounded-xl border border-terminal-border-strong bg-terminal-raised p-1.5 shadow-floating">
                  {CUSTOM_INTERVAL_TYPES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setType(item);
                        setTypeOpen(false);
                      }}
                      className={cn(
                        "h-9 w-full rounded-lg px-3 text-left text-sm font-semibold transition-colors hover:bg-terminal-hover",
                        item === type
                          ? "bg-brand text-[var(--accent-contrast)]"
                          : "text-ink-muted",
                      )}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[96px_minmax(0,180px)] items-center gap-3">
            <label
              htmlFor="custom-interval-value"
              className="text-sm font-semibold text-ink"
            >
              Interval
            </label>
            <input
              ref={inputRef}
              id="custom-interval-value"
              value={interval}
              inputMode="numeric"
              onChange={(event) => {
                const next = event.target.value.replace(/[^\d]/g, "");
                setInterval(next);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") add();
              }}
              className="h-10 rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 text-sm font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </div>
        </div>

        <div data-dialog-footer className="flex min-h-16 items-center justify-end gap-3 border-t border-terminal-border px-5 py-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!resolved}
            onClick={add}
            className="min-h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover disabled:cursor-default disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
