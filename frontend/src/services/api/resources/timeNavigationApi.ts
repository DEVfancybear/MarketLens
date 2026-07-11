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

export type TimeNavigationResolution = {
  shortcut: TimeRangeShortcut;
  timeframe: Timeframe;
  tooltip: string;
  mode: "range" | "all";
  from?: number;
  to?: number;
};

export async function getTimeNavigationShortcuts(): Promise<
  TimeNavigationShortcut[]
> {
  const response = await getJson<{ shortcuts: TimeNavigationShortcut[] }>(
    "chart/time-navigation/shortcuts",
  );
  return response.shortcuts;
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
