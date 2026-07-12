import type { Theme } from "@/store/uiStore";
import { TF_SECONDS, type Timeframe } from "../../types";

/**
 * Chart palette aligned with the application design tokens. Lightweight Charts
 * requires concrete colors, so these values mirror globals.css by theme.
 */
export function chartColors(theme: Theme) {
  const dark = theme === "dark";
  return {
    background: dark ? "#070b12" : "#f7f9fc",
    // Axis label text
    text: dark ? "#f1f5fb" : "#152033",
    axisText: dark ? "#9aa9be" : "#52627a",
    // Grid lines — deliberately faint so they never dominate
    grid: dark ? "rgba(126,145,176,0.085)" : "rgba(82,98,122,0.11)",
    // Price/time scale border
    border: dark ? "#1e2a3c" : "#d1d9e6",
    // Crosshair line + label box
    crosshair: dark ? "rgba(154,169,190,0.74)" : "#52627a",
    crosshairLabelBg: dark ? "#34445e" : "#52627a",
    // Candles — TradingView's current palette uses the same bull/bear pair
    // in both themes (#089981 / #f23645)
    bull: dark ? "#26a69a" : "#087f73",
    bear: dark ? "#ef5b68" : "#ce3f50",
    volumeBull: dark ? "rgba(38,166,154,0.34)" : "rgba(8,127,115,0.28)",
    volumeBear: dark ? "rgba(239,91,104,0.34)" : "rgba(206,63,80,0.28)",
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

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
 * matching TradingView's floating time label.
 */
export function makeTimeFormatter(tf: Timeframe) {
  const intraday = TF_SECONDS[tf] < 86400;
  return (time: number) => {
    const d = new Date(time * 1000);
    if (intraday) {
      const mon = d.toLocaleString("en-US", {
        month: "short",
        timeZone: "UTC",
      });
      return `${d.getUTCDate()} ${mon}  ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    }
    return d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  };
}
