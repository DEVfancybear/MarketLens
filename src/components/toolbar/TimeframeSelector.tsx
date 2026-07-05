"use client";

import { ChevronDown, ChevronUp, Plus, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dropdown } from "@/components/ui/Dropdown";
import { localStore } from "@/services/storage";
import type { Timeframe } from "@/types";
import { cn } from "@/utils/cn";
import {
  DEFAULT_FAVORITE_TIMEFRAMES,
  TIMEFRAME_FAVORITES_KEY,
  TIMEFRAME_MENU_GROUPS,
  normalizeFavoriteTimeframes,
  timeframeShortLabel,
  toggleFavoriteTimeframe,
  visibleToolbarTimeframes,
} from "./timeframeSelectorModel";

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

  useEffect(() => {
    const saved = localStore.get<string[]>(
      TIMEFRAME_FAVORITES_KEY,
      DEFAULT_FAVORITE_TIMEFRAMES,
    );
    const next = normalizeFavoriteTimeframes(saved);
    setFavorites(next.length ? next : DEFAULT_FAVORITE_TIMEFRAMES);
  }, []);

  const visible = useMemo(
    () => visibleToolbarTimeframes(favorites, timeframe),
    [favorites, timeframe],
  );

  const persistFavorites = (next: Timeframe[]) => {
    setFavorites(next);
    localStore.set(TIMEFRAME_FAVORITES_KEY, next);
  };

  const toggleFavorite = (nextTimeframe: Timeframe) => {
    persistFavorites(toggleFavoriteTimeframe(favorites, nextTimeframe));
  };

  return (
    <div className="flex items-center gap-0.5">
      {visible.map((tf) => (
        <button
          key={tf}
          type="button"
          onClick={() => onChange(tf)}
          className={cn(
            "h-7 min-w-[28px] rounded px-1.5 text-[11px] font-semibold transition-colors",
            tf === timeframe
              ? "bg-terminal-hover text-ink"
              : "text-ink hover:bg-terminal-hover",
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
              "flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink",
              open && "bg-terminal-hover text-ink",
            )}
          >
            <ChevronDown size={14} />
          </button>
        )}
      >
        {(close) => (
          <div className="max-h-[min(640px,calc(100vh-56px))] overflow-y-auto bg-[#1f1f1f] py-1 text-[13px] font-semibold text-[#d1d4dc]">
            <button
              type="button"
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
    </div>
  );
}
