import type { Theme } from "@/store/uiStore";
import { TF_SECONDS, type Timeframe } from "../../types";

/**
 * TradingView-style colour palette resolved from the active app theme.
 * Tuned to match TradingView's dark mode (#131722 surface, #26a69a / #ef5350
 * candles, very subtle #1e222d grid, #758696 crosshair).
 */
export function chartColors(theme: Theme) {
  const dark = theme === "dark";
  return {
    background: dark ? "#0f0f0f" : "#ffffff",
    // Axis label text
    text: dark ? "#d1d4dc" : "#131722",
    axisText: dark ? "#9ea4ad" : "#4b5563",
    // Grid lines — deliberately faint so they never dominate
    grid: dark ? "rgba(255,255,255,0.065)" : "#eceff3",
    // Price/time scale border
    border: dark ? "rgba(255,255,255,0.10)" : "#e0e3eb",
    // Crosshair line + label box
    crosshair: dark ? "rgba(117,134,150,0.86)" : "#9598a1",
    crosshairLabelBg: dark ? "#4a4a4a" : "#2a2e39",
    // Candles — TradingView's current palette uses the same bull/bear pair
    // in both themes (#089981 / #f23645)
    bull: "#089981",
    bear: "#f23645",
    volumeBull: dark ? "rgba(8,153,129,0.42)" : "rgba(8,153,129,0.38)",
    volumeBear: dark ? "rgba(242,54,69,0.42)" : "rgba(242,54,69,0.38)",
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
  "4H": 12,
  "1D": 14,
  "1W": 16,
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
