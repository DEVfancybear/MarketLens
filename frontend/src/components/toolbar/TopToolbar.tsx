"use client";
import { useCallback, useEffect } from "react";
import {
  Camera,
  Copy,
  Download,
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
import { TimeframeSelector } from "./TimeframeSelector";
import { AuthControl } from "@/components/auth/AuthControl";
import { IconButton } from "@/components/ui/IconButton";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { useAtomValue, useSetAtom, getDefaultStore } from "jotai";
import {
  timeframeAtom,
  setTimeframeAtom,
  candlesAtom,
  symbolAtom,
} from "@/store/chartStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { backendSessionAtom } from "@/store/authStore";
import { exitReplaySession } from "@/services/replay/replaySocket";
import {
  beginReplaySelectionAtom,
  cancelReplaySelectionAtom,
  replaySelectionModeAtom,
} from "@/components/replay/replayUiState";
import {
  themeAtom,
  rightOpenAtom,
  fullscreenAtom,
  toggleThemeAtom,
  toggleRightAtom,
  setFullscreenAtom,
  setBottomTabAtom,
  logAtom,
  toggleAlertCenterAtom,
} from "@/store/uiStore";
import { cn } from "@/utils/cn";
import { captureChart } from "@/components/chart/chartRegistry";
import {
  chartLayoutPresetAtom,
  replayLayoutModeAtom,
  setChartLayoutPresetAtom,
  setReplayLayoutModeAtom,
  type ChartLayoutPreset,
} from "@/store/replayLayoutStore";

export function TopToolbar() {
  // Atomic selectors: `candles` is intentionally NOT subscribed here — it mutates
  // on every realtime tick and would re-render the whole toolbar. Its length is
  // read lazily in `toggleReplay` via getState(). `timeframe`/`setTimeframe` only
  // change on user action. Backend Replay updates arrive as server events.
  const timeframe = useAtomValue(timeframeAtom);
  const setTimeframe = useSetAtom(setTimeframeAtom);
  const replay = useReplayClientProjection();
  const backendSession = useAtomValue(backendSessionAtom);
  const replaySelection = useAtomValue(replaySelectionModeAtom);
  const beginReplaySelection = useSetAtom(beginReplaySelectionAtom);
  const cancelReplaySelection = useSetAtom(cancelReplaySelectionAtom);
  const theme = useAtomValue(themeAtom);
  const rightOpen = useAtomValue(rightOpenAtom);
  const fullscreen = useAtomValue(fullscreenAtom);
  const toggleTheme = useSetAtom(toggleThemeAtom);
  const toggleRight = useSetAtom(toggleRightAtom);
  const setFullscreen = useSetAtom(setFullscreenAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const doLog = useSetAtom(logAtom);
  const toggleAlertCenter = useSetAtom(toggleAlertCenterAtom);
  const alertCount = useAlertStore((s) => s.alerts.length);
  const chartLayoutPreset = useAtomValue(chartLayoutPresetAtom);
  const replayLayoutMode = useAtomValue(replayLayoutModeAtom);
  const setChartLayoutPreset = useSetAtom(setChartLayoutPresetAtom);
  const setReplayLayoutMode = useSetAtom(setReplayLayoutModeAtom);

  const toggleReplay = () => {
    if (replaySelection !== "idle") {
      cancelReplaySelection();
    } else if (replay.snapshot) {
      void exitReplaySession();
    } else {
      if (!backendSession) {
        setBottomTab("replay");
        return;
      }
      if (getDefaultStore().get(candlesAtom).length < 50) return;
      beginReplaySelection();
      setBottomTab("replay");
    }
  };

  const captureSnapshotBlob = useCallback(async () => {
    let blob: Blob | null = null;
    try {
      blob = await captureChart();
    } catch (err) {
      doLog("error", `Screenshot failed: ${(err as Error).message}`);
      return;
    }
    if (!blob) {
      doLog("warn", "Screenshot failed: chart not ready");
      return null;
    }
    return blob;
  }, [doLog]);

  const downloadSnapshot = useCallback(async () => {
    const blob = await captureSnapshotBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${getDefaultStore().get(symbolAtom)}_${timeframe}_${Date.now()}.png`;
    // The anchor must be in the document for click() to trigger a download in
    // Firefox/strict browsers; revoke is deferred so the browser has time to
    // read the blob (revoking synchronously after click() can abort the save).
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    doLog("info", "Screenshot saved");
  }, [captureSnapshotBlob, doLog, timeframe]);

  const copySnapshot = useCallback(async () => {
    const blob = await captureSnapshotBlob();
    if (!blob) return;
    const clipboard = navigator.clipboard as unknown as {
      write?: (items: unknown[]) => Promise<void>;
    };
    const ClipboardItemCtor = (
      globalThis as unknown as {
        ClipboardItem?: new (items: Record<string, Blob>) => unknown;
      }
    ).ClipboardItem;
    if (!clipboard.write || !ClipboardItemCtor) {
      doLog("warn", "Copy image is not supported in this browser");
      return;
    }
    try {
      await clipboard.write([
        new ClipboardItemCtor({ [blob.type || "image/png"]: blob }),
      ]);
      doLog("info", "Screenshot copied");
    } catch (err) {
      doLog("error", `Copy image failed: ${(err as Error).message}`);
    }
  }, [captureSnapshotBlob, doLog]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (event.altKey && !event.shiftKey) {
        event.preventDefault();
        void downloadSnapshot();
      } else if (event.shiftKey && !event.altKey) {
        event.preventDefault();
        void copySnapshot();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySnapshot, downloadSnapshot]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setFullscreen(false);
    }
  };

  return (
    <div className="flex h-full items-center gap-0 px-2">
      <SymbolSearch />

      <div className="mx-1 h-5 w-px bg-terminal-border" />

      {/* Timeframes — TradingView segmented control */}
      <TimeframeSelector timeframe={timeframe} onChange={setTimeframe} />

      <div className="mx-1 h-5 w-px bg-terminal-border" />

      <IndicatorMenu />
      <SmcMenu />
      <ChartSettingsMenu />

      <button
        onClick={toggleReplay}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded px-2 text-[11px] transition-colors",
          replay.snapshot || replaySelection !== "idle"
            ? "bg-brand/15 text-brand"
            : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
        )}
      >
        <PlayCircle size={14} />
        {replaySelection !== "idle" ? "Cancel select" : "Replay"}
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
            {([
              ["single", "Single"],
              ["two_horizontal", "2 Horizontal"],
              ["two_vertical", "2 Vertical"],
              ["grid_2x2", "Grid 2×2"],
            ] as const).map(([preset, label]) => (
              <MenuItem
                key={preset}
                active={chartLayoutPreset === preset}
                onClick={() => {
                  setChartLayoutPreset(preset as ChartLayoutPreset);
                  close();
                }}
              >
                <span className="flex-1">{label}</span>
                {chartLayoutPreset === preset && <span>✓</span>}
              </MenuItem>
            ))}
            <div className="my-1 border-t border-terminal-border" />
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Replay scope
            </div>
            <MenuItem
              active={replayLayoutMode === "single_chart"}
              onClick={() => setReplayLayoutMode("single_chart")}
            >
              <span className="flex-1">Current chart</span>
              {replayLayoutMode === "single_chart" && <span>✓</span>}
            </MenuItem>
            <MenuItem
              active={replayLayoutMode === "all_charts"}
              className={chartLayoutPreset === "single" ? "cursor-not-allowed opacity-40" : undefined}
              onClick={chartLayoutPreset === "single" ? undefined : () => setReplayLayoutMode("all_charts")}
            >
              <span className="flex-1">All charts</span>
              {replayLayoutMode === "all_charts" && <span>✓</span>}
            </MenuItem>
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
        <Dropdown
          align="right"
          width={238}
          trigger={(open) => (
            <IconButton label="Take a snapshot" active={open}>
              <Camera size={15} />
            </IconButton>
          )}
        >
          {(close) => (
            <div className="py-1">
              <div className="px-3 pb-1 pt-1 text-[11px] font-semibold text-ink-muted">
                Take a snapshot
              </div>
              <MenuItem
                onClick={() => {
                  close();
                  void downloadSnapshot();
                }}
                className="h-8 text-[12px] font-semibold"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Download size={15} />
                  <span className="truncate">Download image</span>
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-ink-faint">
                  Ctrl + Alt + S
                </span>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  void copySnapshot();
                }}
                className="h-8 text-[12px] font-semibold"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <Copy size={15} />
                  <span className="truncate">Copy image</span>
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-ink-faint">
                  Ctrl + Shift + S
                </span>
              </MenuItem>
            </div>
          )}
        </Dropdown>
        <IconButton
          label="Toggle watchlist"
          onClick={toggleRight}
          active={rightOpen}
        >
          {rightOpen ? (
            <PanelRightClose size={15} />
          ) : (
            <PanelRightOpen size={15} />
          )}
        </IconButton>
        <IconButton label="Theme" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <IconButton label="Fullscreen" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
        <div className="mx-1 h-5 w-px bg-terminal-border" />
        <AuthControl />
      </div>
    </div>
  );
}
