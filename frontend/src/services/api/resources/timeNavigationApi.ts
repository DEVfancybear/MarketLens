import type { Timeframe } from "@/types";
import { getJson, postJson } from "../client";

export type TimeRangeShortcut =
  | "1D"
  | "5D"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "5Y"
  | "All";

export type TimeNavigationShortcut = {
  id: TimeRangeShortcut;
  timeframe: Timeframe;
  tooltip: string;
};

export type TimeNavigationCatalog = {
  shortcuts: TimeNavigationShortcut[];
  goTo: {
    hotkey: { label: string; key: string; altKey: boolean };
    specificTimeTimeframes: string[];
  };
  /**
   * The backend-owned display timezone for the Exchange option. Candle and
   * drawing timestamps remain Unix seconds (UTC); this value only controls
   * how those timestamps are rendered by the chart UI.
   */
  timeZone?: {
    exchange: string;
    data: "UTC";
  };
};

export type TimeNavigationResolution = {
  shortcut: TimeRangeShortcut;
  timeframe: Timeframe;
  tooltip: string;
  mode: "range" | "all";
  from?: number;
  to?: number;
};

export function getTimeNavigationCatalog(): Promise<TimeNavigationCatalog> {
  return getJson<TimeNavigationCatalog>("chart/time-navigation/shortcuts");
}

export function resolveTimeNavigationShortcut(
  shortcut: TimeRangeShortcut,
  anchorTime: number,
): Promise<TimeNavigationResolution> {
  return postJson<TimeNavigationResolution>("chart/time-navigation/resolve", {
    shortcut,
    anchorTime,
  });
}
