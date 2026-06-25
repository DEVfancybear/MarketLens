"use client";
import {
  Camera,
  Maximize2,
  Minimize2,
  Moon,
  Sun,
  PlayCircle,
  Layout as LayoutIcon,
  PanelRightClose,
  PanelRightOpen,
  Bell,
} from "lucide-react";
import { SymbolSearch } from "./SymbolSearch";
import { useAlertStore } from "@/store/alertStore";
import { IndicatorMenu } from "./IndicatorMenu";
import { SmcMenu } from "./SmcMenu";
import { ChartSettingsMenu } from "./ChartSettingsMenu";
import { ConnectionBadge } from "./ConnectionBadge";
import { IconButton } from "@/components/ui/IconButton";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { useChartStore } from "@/store/chartStore";
import { useReplayStore } from "@/store/replayStore";
import { useUIStore } from "@/store/uiStore";
import { TIMEFRAMES, type Timeframe } from "@/types";
import { cn } from "@/utils/cn";
import { captureChart } from "@/components/chart/chartRegistry";

export function TopToolbar() {
  // Atomic selectors: `candles` is intentionally NOT subscribed here — it mutates
  // on every realtime tick and would re-render the whole toolbar. Its length is
  // read lazily in `toggleReplay` via getState(). `timeframe`/`setTimeframe` only
  // change on user action. (replay/ui stores no longer churn per tick — see the
  // guarded `replayStore.setTotal`.)
  const timeframe = useChartStore((s) => s.timeframe);
  const setTimeframe = useChartStore((s) => s.setTimeframe);
  const replay = useReplayStore();
  const ui = useUIStore();
  const alertCount = useAlertStore((s) => s.alerts.length);
  const toggleAlertCenter = useUIStore((s) => s.toggleAlertCenter);

  const toggleReplay = () => {
    if (replay.active) {
      replay.disarm();
    } else if (replay.selecting) {
      replay.cancelSelect();
    } else {
      if (useChartStore.getState().candles.length < 50) return;
      // Enter TradingView-style bar selection: click a candle to start.
      replay.beginSelect();
      ui.setBottomTab("replay");
    }
  };

  const screenshot = async () => {
    const blob = await captureChart();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${useChartStore.getState().symbol}_${timeframe}_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    ui.log("info", "Screenshot saved");
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      ui.setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      ui.setFullscreen(false);
    }
  };

  return (
    <div className="flex h-full items-center gap-0 px-2">
      <SymbolSearch />

      <div className="mx-1 h-5 w-px bg-terminal-border" />

      {/* Timeframes — TradingView segmented control */}
      <div className="flex items-center gap-0.5">
        {TIMEFRAMES.map((tf: Timeframe) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={cn(
              "h-7 min-w-[28px] rounded px-1.5 text-[11px] font-medium transition-colors",
              tf === timeframe
                ? "bg-terminal-hover font-semibold text-ink"
                : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-terminal-border" />

      <IndicatorMenu />
      <SmcMenu />
      <ChartSettingsMenu />

      <button
        onClick={toggleReplay}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded px-2 text-[11px] transition-colors",
          replay.active || replay.selecting
            ? "bg-brand/15 text-brand"
            : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
        )}
      >
        <PlayCircle size={14} />
        {replay.selecting ? "Select bar…" : "Replay"}
      </button>

      {/* Layout selector (visual presets) */}
      <Dropdown
        width={160}
        trigger={() => (
          <button className="flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink">
            <LayoutIcon size={14} />
            Layout
          </button>
        )}
      >
        {(close) => (
          <div>
            {["Single", "2 Horizontal", "2 Vertical", "Grid 2×2"].map((l) => (
              <MenuItem key={l} onClick={close}>
                {l}
              </MenuItem>
            ))}
          </div>
        )}
      </Dropdown>

      <div className="ml-auto flex items-center gap-0">
        <ConnectionBadge />
        <div className="mx-1 h-5 w-px bg-terminal-border" />
        <button
          onClick={toggleAlertCenter}
          className="relative flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
          title="Alerts"
          aria-label="Alerts"
        >
          <Bell size={15} />
          {alertCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-choch px-0.5 text-[9px] font-bold text-black">
              {alertCount}
            </span>
          )}
        </button>
        <IconButton label="Screenshot" onClick={screenshot}>
          <Camera size={15} />
        </IconButton>
        <IconButton
          label="Toggle watchlist"
          onClick={ui.toggleRight}
          active={ui.rightOpen}
        >
          {ui.rightOpen ? (
            <PanelRightClose size={15} />
          ) : (
            <PanelRightOpen size={15} />
          )}
        </IconButton>
        <IconButton label="Theme" onClick={ui.toggleTheme}>
          {ui.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <IconButton label="Fullscreen" onClick={toggleFullscreen}>
          {ui.fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
      </div>
    </div>
  );
}
