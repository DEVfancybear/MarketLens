import type { Timeframe } from "@/types";

export type TimeframeMenuItem = {
  label: string;
  timeframe?: Timeframe;
};

export type TimeframeMenuGroup = {
  label: string;
  items: TimeframeMenuItem[];
};

export const TIMEFRAME_FAVORITES_KEY = "tv:favoriteTimeframes";
export const DEFAULT_FAVORITE_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m"];

export const TIMEFRAME_MENU_GROUPS: TimeframeMenuGroup[] = [
  {
    label: "TICKS",
    items: [
      { label: "1 tick" },
      { label: "10 ticks" },
      { label: "100 ticks" },
      { label: "1000 ticks" },
    ],
  },
  {
    label: "SECONDS",
    items: [
      { label: "1 second" },
      { label: "5 seconds" },
      { label: "10 seconds" },
      { label: "15 seconds" },
      { label: "30 seconds" },
      { label: "45 seconds" },
    ],
  },
  {
    label: "MINUTES",
    items: [
      { label: "1 minute", timeframe: "1m" },
      { label: "2 minutes" },
      { label: "3 minutes", timeframe: "3m" },
      { label: "5 minutes", timeframe: "5m" },
      { label: "10 minutes" },
      { label: "15 minutes", timeframe: "15m" },
      { label: "30 minutes", timeframe: "30m" },
      { label: "45 minutes" },
    ],
  },
  {
    label: "HOURS",
    items: [
      { label: "1 hour", timeframe: "1H" },
      { label: "2 hours", timeframe: "2H" },
      { label: "3 hours" },
      { label: "4 hours", timeframe: "4H" },
    ],
  },
  {
    label: "DAYS",
    items: [
      { label: "1 day", timeframe: "1D" },
      { label: "1 week", timeframe: "1W" },
      { label: "1 month", timeframe: "1M" },
      { label: "3 months" },
      { label: "6 months" },
      { label: "12 months" },
    ],
  },
];

const TIMEFRAME_ORDER = new Map<Timeframe, number>();
for (const group of TIMEFRAME_MENU_GROUPS) {
  for (const item of group.items) {
    if (item.timeframe && !TIMEFRAME_ORDER.has(item.timeframe)) {
      TIMEFRAME_ORDER.set(item.timeframe, TIMEFRAME_ORDER.size);
    }
  }
}

export function isSupportedTimeframe(value: string): value is Timeframe {
  return TIMEFRAME_ORDER.has(value as Timeframe);
}

export function timeframeShortLabel(timeframe: Timeframe): string {
  return timeframe;
}

function byTimeframeOrder(a: Timeframe, b: Timeframe): number {
  return (TIMEFRAME_ORDER.get(a) ?? 0) - (TIMEFRAME_ORDER.get(b) ?? 0);
}

export function normalizeFavoriteTimeframes(
  values: readonly string[],
): Timeframe[] {
  const unique = new Set<Timeframe>();
  for (const value of values) {
    if (isSupportedTimeframe(value)) unique.add(value);
  }
  return [...unique].sort(byTimeframeOrder);
}

export function toggleFavoriteTimeframe(
  values: readonly string[],
  timeframe: Timeframe,
): Timeframe[] {
  const next = new Set(normalizeFavoriteTimeframes(values));
  if (next.has(timeframe)) next.delete(timeframe);
  else next.add(timeframe);
  return [...next].sort(byTimeframeOrder);
}

export function visibleToolbarTimeframes(
  favorites: readonly string[],
  active: Timeframe,
): Timeframe[] {
  const visible = normalizeFavoriteTimeframes(favorites);
  if (!visible.includes(active)) visible.push(active);
  return visible.sort(byTimeframeOrder);
}
