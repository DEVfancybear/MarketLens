"use client";

import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Plus, Star, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "@/components/ui/Dropdown";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import {
  getFavoriteTimeframes,
  replaceFavoriteTimeframes,
} from "@/services/api/resources/settingsApi";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
import { localStore } from "@/services/storage";
import { authStatusAtom, backendSessionAtom } from "@/store/authStore";
import { logAtom } from "@/store/uiStore";
import type { Timeframe } from "@/types";
import { cn } from "@/utils/cn";
import {
  CUSTOM_INTERVAL_TYPES,
  type CustomIntervalType,
  DEFAULT_FAVORITE_TIMEFRAMES,
  TIMEFRAME_FAVORITES_KEY,
  TIMEFRAME_MENU_GROUPS,
  addFavoriteTimeframe,
  customIntervalToTimeframe,
  normalizeFavoriteTimeframes,
  timeframeShortLabel,
  toggleFavoriteTimeframe,
  visibleToolbarTimeframes,
} from "./timeframeSelectorModel";
import { useAtomValue, useSetAtom } from "jotai";

export function TimeframeSelector({
  timeframe,
  onChange,
}: {
  timeframe: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}) {
  const [favorites, setFavorites] = useState<Timeframe[]>(
    DEFAULT_FAVORITE_TIMEFRAMES,
  );
  const [customOpen, setCustomOpen] = useState(false);
  const authStatus = useAtomValue(authStatusAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const log = useSetAtom(logAtom);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const favoritesRevisionRef = useRef(0);

  useEffect(() => {
    const saved = localStore.get<string[]>(
      TIMEFRAME_FAVORITES_KEY,
      DEFAULT_FAVORITE_TIMEFRAMES,
    );
    const next = normalizeFavoriteTimeframes(saved);
    setFavorites(next.length ? next : DEFAULT_FAVORITE_TIMEFRAMES);
  }, []);

  useEffect(() => {
    if (authStatus !== "anonymous") return;
    localStore.remove(TIMEFRAME_FAVORITES_KEY);
    setFavorites(DEFAULT_FAVORITE_TIMEFRAMES);
  }, [authStatus]);

  useEffect(() => {
    if (authStatus === "anonymous" || !backendSession) return;

    let cancelled = false;
    const requestRevision = favoritesRevisionRef.current;
    void getFavoriteTimeframes()
      .then(({ timeframes }) => {
        if (cancelled || requestRevision !== favoritesRevisionRef.current) return;
        const normalized = normalizeFavoriteTimeframes(timeframes);
        setFavorites(normalized);
        localStore.set(TIMEFRAME_FAVORITES_KEY, normalized);
      })
      .catch((error) => {
        if (cancelled) return;
        log(
          "warn",
          `Timeframe favorites loaded from local cache: ${userFacingErrorMessage(error, "unknown error")}`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [authStatus, backendSession, log]);

  const visible = useMemo(
    () => visibleToolbarTimeframes(favorites, timeframe),
    [favorites, timeframe],
  );

  const persistFavorites = useCallback(
    (next: Timeframe[]) => {
      const normalized = normalizeFavoriteTimeframes(next);
      favoritesRevisionRef.current += 1;
      setFavorites(normalized);
      localStore.set(TIMEFRAME_FAVORITES_KEY, normalized);
      if (!backendSession) return;

      // Queue writes so two quick star clicks cannot leave an older list on the server.
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(() => replaceFavoriteTimeframes(normalized))
        .then(() => undefined)
        .catch((error) => {
          log(
            "error",
            `Timeframe favorites sync failed: ${userFacingErrorMessage(error, "unknown error")}`,
          );
        });
    },
    [backendSession, log],
  );

  const toggleFavorite = useCallback(
    (nextTimeframe: Timeframe) => {
      persistFavorites(toggleFavoriteTimeframe(favorites, nextTimeframe));
    },
    [favorites, persistFavorites],
  );

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-terminal-border bg-terminal-input p-0.5">
      {visible.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={cn(
            "h-8 min-w-8 rounded-md border px-2 text-[11px] font-semibold transition-all",
            tf === timeframe
              ? "border-brand/25 bg-brand-soft text-brand shadow-[inset_0_1px_0_var(--panel-highlight)]"
              : "border-transparent text-ink-muted hover:bg-terminal-hover hover:text-ink",
          )}
        >
          {timeframeShortLabel(tf)}
        </button>
      ))}

      <Dropdown
        width={236}
        scrollMode="content"
        trigger={(open) => (
          <button
            type="button"
            aria-label="Select interval"
            title="Select interval"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink active:bg-terminal-pressed",
              open && "border-brand/25 bg-brand-soft text-brand",
            )}
          >
            <ChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-[min(70dvh,640px)] overflow-y-auto overscroll-contain py-1 text-[13px] font-semibold text-ink [scrollbar-gutter:stable]">
            <button
              type="button"
              onClick={() => {
                close();
                setCustomOpen(true);
              }}
              className="flex h-10 w-full items-center gap-2 border-b border-[#343434] px-3 text-left text-[#d1d4dc] transition-colors hover:bg-[#2a2a2a] hover:text-[#f0f3fa]"
            >
              <Plus size={18} className="text-[#b2b5be]" />
              <span>Add custom interval...</span>
            </button>

            {TIMEFRAME_MENU_GROUPS.map((group) => (
              <div key={group.label} className="border-b border-[#343434] py-2">
                <div className="mb-1 flex h-6 items-center justify-between px-3 text-[11px] font-semibold uppercase text-[#8a8f98]">
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
                            ? "bg-[#f0f3fa] text-[#131722]"
                            : supported
                              ? "text-[#d1d4dc] hover:bg-[#2f2f2f] hover:text-[#f0f3fa]"
                              : "cursor-default text-[#666a73]",
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
                                  ? "text-[#131722]"
                                  : "text-[#70757f]"
                                : favorite
                                  ? "text-[#f0f3fa]"
                                  : "text-[#8a8f98] opacity-0 transition-opacity group-hover:opacity-100",
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
            persistFavorites(addFavoriteTimeframe(favorites, nextTimeframe));
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
      className="fixed inset-0 z-[90] bg-black/10"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        className="fixed w-[400px] max-w-[calc(100vw-32px)] overflow-visible rounded-md border border-[#2f2f2f] bg-[#1f1f1f] text-[#d1d4dc] shadow-2xl shadow-black/60"
        style={dialogStyle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          {...dragHandleProps}
          className={cn(
            "flex h-[68px] items-center justify-between border-b border-[#343434] px-5",
            dragHandleClassName,
          )}
        >
          <div className="text-[22px] font-semibold text-[#d1d4dc]">
            Add custom interval
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-[#d1d4dc] hover:bg-[#2a2a2a]"
          >
            <X size={22} />
          </button>
        </div>

        <div className="space-y-3 px-5 py-5">
          <div className="grid grid-cols-[96px_minmax(0,180px)] items-center gap-3">
            <label className="text-[14px] font-semibold text-[#d1d4dc]">
              Type
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setTypeOpen((open) => !open)}
                className={cn(
                  "flex h-[36px] w-full items-center justify-between rounded-md border border-[#5d606b] bg-[#202020] px-2 text-left text-[14px] font-semibold text-[#f0f3fa]",
                  typeOpen && "border-[#2962ff]",
                )}
              >
                <span>{type}</span>
                <ChevronDown
                  size={16}
                  className={cn("transition-transform", typeOpen && "rotate-180")}
                />
              </button>
              {typeOpen && (
                <div className="absolute left-0 top-[38px] z-[95] w-[76px] overflow-hidden rounded-sm border border-[#252525] bg-[#111] py-1 shadow-2xl shadow-black/60">
                  {CUSTOM_INTERVAL_TYPES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setType(item);
                        setTypeOpen(false);
                      }}
                      className={cn(
                        "h-8 w-full px-3 text-left text-[14px] font-semibold transition-colors hover:bg-[#2a2a2a]",
                        item === type
                          ? "bg-[#f0f3fa] text-[#131722]"
                          : "text-[#d1d4dc]",
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
              className="text-[14px] font-semibold text-[#d1d4dc]"
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
              className="h-[36px] rounded-md border border-[#5d606b] bg-[#202020] px-2 text-[14px] font-semibold text-[#f0f3fa] outline-none focus:border-[#2962ff] focus:ring-1 focus:ring-[#2962ff]"
            />
          </div>
        </div>

        <div className="flex h-[66px] items-center justify-end gap-3 border-t border-[#343434] px-5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-[#f0f3fa] px-4 text-[14px] font-semibold text-[#f0f3fa] hover:bg-[#2a2a2a]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!resolved}
            onClick={add}
            className="h-9 rounded-md bg-[#f0f3fa] px-4 text-[14px] font-semibold text-[#131722] hover:bg-white disabled:cursor-default disabled:bg-[#4a4a4a] disabled:text-[#666a73] disabled:hover:bg-[#4a4a4a]"
          >
            Add
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
