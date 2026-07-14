import type { Theme } from "@/store/uiStore";
import { TF_SECONDS, type Timeframe } from "../../types";
import type { TickMarkFormatter } from "lightweight-charts";

/**
 * Canvas-safe mirror of the semantic CSS theme. Keep this contract in sync
 * with globals.css; Lightweight Charts cannot consume CSS variables directly.
 */
export function chartColors(theme: Theme) {
  const dark = theme === "dark";
  return {
    background: dark ? "#090d16" : "#ffffff",
    // Axis label text
    text: dark ? "#f2f5fb" : "#111827",
    axisText: dark ? "#9aa7bd" : "#56637a",
    // Grid lines — deliberately faint so they never dominate
    grid: dark ? "rgba(154,167,189,0.09)" : "rgba(86,99,122,0.10)",
    // Price/time scale border
    border: dark ? "#232d43" : "#d9e0eb",
    // Crosshair line + label box
    crosshair: dark ? "rgba(154,167,189,0.78)" : "rgba(86,99,122,0.76)",
    crosshairLabelBg: dark ? "#34405a" : "#56637a",
    // Candles — TradingView's current palette uses the same bull/bear pair
    // in both themes (#089981 / #f23645)
    bull: dark ? "#24c99a" : "#067a65",
    bear: dark ? "#ff5d7d" : "#d9365a",
    volumeBull: dark ? "rgba(36,201,154,0.38)" : "rgba(6,122,101,0.30)",
    volumeBear: dark ? "rgba(255,93,125,0.38)" : "rgba(217,54,90,0.30)",
  };
}

type ZonedTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function zonedTimeParts(
  date: Date,
  timeZone?: string,
  locale = "en-US",
): ZonedTimeParts {
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  if (timeZone) options.timeZone = timeZone;
  const parts = new Intl.DateTimeFormat(locale, options).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** TradingView-style bar spacing per timeframe — tighter on low TFs. */
export const BAR_SPACING: Record<Timeframe, number> = {
  "1m": 4,
  "3m": 5,
  "5m": 6,
  "15m": 8,
  "30m": 10,
  "1H": 10,
  "2H": 11,
  "4H": 12,
  "1D": 14,
  "1W": 16,
  "1M": 18,
};

/**
 * Crosshair time-tooltip formatter: HH:mm for intraday, "d MMM 'yy" for daily+,
 * matching TradingView's floating time label. `timeZone` is the backend-owned
 * IANA display zone from the time-navigation catalog; the timestamp itself
 * remains the UTC Unix coordinate supplied by Lightweight Charts.
 */
export function makeTimeFormatter(tf: Timeframe, timeZone?: string) {
  const intraday = TF_SECONDS[tf] < 86400;
  return (time: number) => {
    const d = new Date(time * 1000);
    const parts = zonedTimeParts(d, timeZone);
    if (intraday) {
      return `${parts.day} ${parts.month}  ${parts.hour}:${parts.minute}`;
    }
    const options: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "short",
      year: "2-digit",
    };
    if (timeZone) options.timeZone = timeZone;
    return d.toLocaleDateString("en-US", options);
  };
}

// Lightweight Charts formats its built-in time scale in UTC. Keep the axis in
// the same selected chart time zone as Go To and the floating crosshair label.
export function makeTickMarkFormatter(timeZone?: string): TickMarkFormatter {
  return (time, tickMarkType, locale) => {
    if (typeof time !== "number") return null;
    const parts = zonedTimeParts(new Date(time * 1000), timeZone, locale || "en-US");
    switch (tickMarkType) {
      case 0: // TickMarkType.Year
        return parts.year;
      case 1: // TickMarkType.Month
        return parts.month;
      case 2: // TickMarkType.DayOfMonth
        return `${parts.day} ${parts.month}`;
      case 4: // TickMarkType.TimeWithSeconds
        return `${parts.hour}:${parts.minute}:${parts.second}`;
      case 3: // TickMarkType.Time
      default:
        return `${parts.hour}:${parts.minute}`;
    }
  };
}
