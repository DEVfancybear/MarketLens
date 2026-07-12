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
  Star,
  ListTree,
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
  rightPanelTabAtom,
  showRightPanelTabAtom,
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
import {
  activeLayoutIdAtom,
  createCurrentLayoutAtom,
  deleteActiveLayoutAtom,
  layoutsAtom,
  loadLayoutAtom,
  makeActiveLayoutDefaultAtom,
  overwriteActiveLayoutAtom,
} from "@/store/layoutStore";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";

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
  const rightPanelTab = useAtomValue(rightPanelTabAtom);
  const fullscreen = useAtomValue(fullscreenAtom);
  const toggleTheme = useSetAtom(toggleThemeAtom);
  const toggleRight = useSetAtom(toggleRightAtom);
  const showRightPanelTab = useSetAtom(showRightPanelTabAtom);
  const setFullscreen = useSetAtom(setFullscreenAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const doLog = useSetAtom(logAtom);
  const toggleAlertCenter = useSetAtom(toggleAlertCenterAtom);
  const alertCount = useAlertStore((s) => s.alerts.length);
  const chartLayoutPreset = useAtomValue(chartLayoutPresetAtom);
  const replayLayoutMode = useAtomValue(replayLayoutModeAtom);
  const setChartLayoutPreset = useSetAtom(setChartLayoutPresetAtom);
  const setReplayLayoutMode = useSetAtom(setReplayLayoutModeAtom);
  const layouts = useAtomValue(layoutsAtom);
  const activeLayoutId = useAtomValue(activeLayoutIdAtom);
  const loadLayout = useSetAtom(loadLayoutAtom);
  const createCurrentLayout = useSetAtom(createCurrentLayoutAtom);
  const overwriteActiveLayout = useSetAtom(overwriteActiveLayoutAtom);
  const makeActiveLayoutDefault = useSetAtom(makeActiveLayoutDefaultAtom);
  const deleteActiveLayout = useSetAtom(deleteActiveLayoutAtom);
  const activeLayout = layouts.find((layout) => layout.id === activeLayoutId);

  const runLayoutAction = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      try {
        await action();
        doLog("info", success);
      } catch (error) {
        doLog("error", `Layout action failed: ${userFacingErrorMessage(error, "request failed")}`);
      }
    },
    [doLog],
  );

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
    <div className="grid h-full min-w-0 grid-rows-2">
      <div className="flex h-11 min-w-0 items-center border-b border-terminal-border/80 px-3">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-signal text-[11px] font-black tracking-tight text-white shadow-[0_6px_18px_var(--shell-glow)]">
            S
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-bold tracking-[-0.01em] text-ink">Trading Terminal</span>
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint sm:inline">Institutional workspace</span>
          </div>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ConnectionBadge />
          <div className="mx-1 h-5 w-px bg-terminal-border" />
          <button
            onClick={toggleAlertCenter}
            className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink active:bg-terminal-pressed"
            title="Alerts"
            aria-label="Alerts"
          >
            <Bell size={15} />
            {alertCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-bold text-ink-inverse">
                {alertCount}
              </span>
            )}
          </button>
          <IconButton label="Theme" onClick={toggleTheme} size="sm">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </IconButton>
          <IconButton label="Fullscreen" onClick={toggleFullscreen} size="sm">
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </IconButton>
          <div className="mx-1 h-5 w-px bg-terminal-border" />
          <AuthControl />
        </div>
      </div>

      <div className="flex h-11 min-w-0 items-center gap-0 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
          replay.snapshot || replaySelection !== "idle"
            ? "bg-brand/15 text-brand"
            : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
        )}
      >
        <PlayCircle size={14} />
        {replaySelection !== "idle" ? "Cancel select" : "Replay"}
      </button>

      {/* Persisted layouts plus visual chart presets. */}
      <Dropdown
        width={230}
        trigger={() => (
          <button className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink">
            <LayoutIcon size={14} />
            {activeLayout?.name ?? "Layout"}
          </button>
        )}
      >
        {(close) => (
          <div>
            {backendSession && (
              <>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  Saved layouts
                </div>
                {layouts.length === 0 && (
                  <div className="px-3 py-1.5 text-[11px] text-ink-faint">No saved layouts</div>
                )}
                {layouts.map((layout) => (
                  <MenuItem
                    key={layout.id}
                    active={layout.id === activeLayoutId}
                    onClick={() => {
                      try {
                        loadLayout(layout);
                        doLog("info", `Layout loaded: ${layout.name}`);
                        close();
                      } catch (error) {
                        doLog("error", `Layout load failed: ${userFacingErrorMessage(error, "invalid snapshot")}`);
                      }
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{layout.name}</span>
                    {layout.isDefault && <Star size={11} className="fill-current" />}
                  </MenuItem>
                ))}
                <div className="my-1 border-t border-terminal-border" />
                <MenuItem
                  onClick={() => {
                    const name = window.prompt("Layout name", activeLayout?.name ?? "My layout")?.trim();
                    if (!name) return;
                    void runLayoutAction(
                      () => createCurrentLayout({ name, isDefault: layouts.length === 0 }),
                      `Layout saved: ${name}`,
                    );
                    close();
                  }}
                >
                  Save current as…
                </MenuItem>
                <MenuItem
                  className={!activeLayout ? "cursor-not-allowed opacity-40" : undefined}
                  onClick={activeLayout ? () => {
                    void runLayoutAction(overwriteActiveLayout, `Layout updated: ${activeLayout.name}`);
                    close();
                  } : undefined}
                >
                  Update selected
                </MenuItem>
                <MenuItem
                  className={!activeLayout || activeLayout.isDefault ? "cursor-not-allowed opacity-40" : undefined}
                  onClick={activeLayout && !activeLayout.isDefault ? () => {
                    void runLayoutAction(makeActiveLayoutDefault, `Default layout: ${activeLayout.name}`);
                    close();
                  } : undefined}
                >
                  Make selected default
                </MenuItem>
                <MenuItem
                  className={!activeLayout ? "cursor-not-allowed opacity-40 text-red-400" : "text-red-400"}
                  onClick={activeLayout ? () => {
                    if (!window.confirm(`Delete layout “${activeLayout.name}”?`)) return;
                    void runLayoutAction(deleteActiveLayout, `Layout deleted: ${activeLayout.name}`);
                    close();
                  } : undefined}
                >
                  Delete selected
                </MenuItem>
                <div className="my-1 border-t border-terminal-border" />
              </>
            )}
            {!backendSession && (
              <div className="px-3 py-1.5 text-[11px] text-ink-faint">
                Sign in to save layouts
              </div>
            )}
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Chart arrangement
            </div>
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

      <div className="ml-auto flex shrink-0 items-center gap-0">
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
        <IconButton
          label="Object tree"
          onClick={() => showRightPanelTab("objects")}
          active={rightOpen && rightPanelTab === "objects"}
        >
          <ListTree size={15} />
        </IconButton>
      </div>
      </div>
    </div>
  );
}
