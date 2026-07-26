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
  ChartCandlestick,
  WalletCards,
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
} from "@/store/chartStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { backendSessionAtom } from "@/store/authStore";
import { exitReplaySession } from "@/services/replay/replaySocket";
import {
  beginReplaySelectionAtom,
  cancelReplaySelectionAtom,
  replaySelectionModeAtom,
} from "@/store/replayUiState";
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
  desktopWorkspaceAtom,
  setDesktopWorkspaceAtom,
} from "@/store/uiStore";
import { cn } from "@/utils/cn";
import { useChartSnapshotActions } from "@/hooks/useChartSnapshotActions";
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
import { usePlatformDialog } from "@/components/ui/PlatformDialog";

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
  const desktopWorkspace = useAtomValue(desktopWorkspaceAtom);
  const fullscreen = useAtomValue(fullscreenAtom);
  const toggleTheme = useSetAtom(toggleThemeAtom);
  const toggleRight = useSetAtom(toggleRightAtom);
  const showRightPanelTab = useSetAtom(showRightPanelTabAtom);
  const setDesktopWorkspace = useSetAtom(setDesktopWorkspaceAtom);
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
  const hasDefaultLayout = layouts.some((layout) => layout.isDefault);
  const snapshot = useChartSnapshotActions();
  const { requestPrompt, requestConfirm, dialog } = usePlatformDialog();

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

  const saveCurrentLayout = useCallback(() => {
    if (!backendSession) {
      doLog("warn", "Sign in to save layouts");
      return;
    }
    void requestPrompt({
      title: "Save layout",
      label: "Layout name",
      defaultValue: activeLayout?.name ?? "My layout",
    }).then((value) => {
      const name = value?.trim();
      if (!name) return;
      void runLayoutAction(
        () => createCurrentLayout({
          name,
          isDefault: !hasDefaultLayout,
        }),
        `Layout saved: ${name}`,
      );
    });
  }, [
    activeLayout?.name,
    backendSession,
    createCurrentLayout,
    doLog,
    hasDefaultLayout,
    requestPrompt,
    runLayoutAction,
  ]);

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

  const downloadSnapshot = snapshot.download;
  const copySnapshot = snapshot.copy;

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
      } else if (!event.altKey && !event.shiftKey && activeLayout) {
        event.preventDefault();
        void runLayoutAction(
          overwriteActiveLayout,
          `Layout updated: ${activeLayout.name}`,
        );
      } else if (!event.altKey && !event.shiftKey) {
        event.preventDefault();
        saveCurrentLayout();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeLayout,
    copySnapshot,
    downloadSnapshot,
    overwriteActiveLayout,
    runLayoutAction,
    saveCurrentLayout,
  ]);

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
    <div className="flex h-full items-center gap-2 px-3">
      <div className="mr-1 flex h-10 shrink-0 items-center gap-2.5 pr-3 xl:min-w-[154px]">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-[var(--accent-contrast)] shadow-accent">
          <ChartCandlestick size={19} strokeWidth={2.2} />
        </div>
        <div className="hidden min-w-0 xl:block">
          <div className="text-[13px] font-bold leading-4 tracking-[-0.02em] text-ink">SMC Terminal</div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-ink-faint">Live workspace</div>
        </div>
      </div>

      <nav
        aria-label="Desktop workspace"
        className="flex h-10 shrink-0 items-center gap-1 rounded-xl border border-terminal-border bg-terminal-panel-2/70 p-1"
      >
        <button
          type="button"
          aria-current={desktopWorkspace === "chart" ? "page" : undefined}
          onClick={() => setDesktopWorkspace("chart")}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
            desktopWorkspace === "chart"
              ? "bg-terminal-raised text-ink shadow-sm"
              : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
          )}
        >
          <ChartCandlestick size={14} />
          Chart
        </button>
        <button
          type="button"
          aria-current={desktopWorkspace === "trade" ? "page" : undefined}
          onClick={() => setDesktopWorkspace("trade")}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
            desktopWorkspace === "trade"
              ? "bg-brand/15 text-brand"
              : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
          )}
        >
          <WalletCards size={14} />
          Trade
        </button>
      </nav>

      <div
        className={cn(
          "h-10 items-center gap-1 rounded-xl border border-terminal-border bg-terminal-panel-2/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]",
          desktopWorkspace === "chart" ? "flex" : "hidden",
        )}
      >
      <SymbolSearch />

      <div className="mx-1 h-5 w-px bg-terminal-border" />

      {/* Timeframes — TradingView segmented control */}
      <TimeframeSelector timeframe={timeframe} onChange={setTimeframe} />

      </div>

      <div
        className={cn(
          "h-10 items-center gap-0.5 rounded-xl border border-terminal-border bg-terminal-panel-2/55 p-1",
          desktopWorkspace === "chart" ? "flex" : "hidden",
        )}
      >
      <IndicatorMenu />
      <SmcMenu />
      <ChartSettingsMenu />

      <button
        onClick={toggleReplay}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors",
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
        trigger={(open) => (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={activeLayout?.name ? `Layout: ${activeLayout.name}` : "Layout"}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70"
          >
            <LayoutIcon size={14} />
            {activeLayout?.name ?? "Layout"}
          </button>
        )}
      >
        {(close) => (
          <div role="menu" aria-label="Layout">
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
                    close();
                    saveCurrentLayout();
                  }}
                >
                  Save current as…
                </MenuItem>
                <MenuItem
                  disabled={!activeLayout}
                  onClick={activeLayout ? () => {
                    void runLayoutAction(overwriteActiveLayout, `Layout updated: ${activeLayout.name}`);
                    close();
                  } : undefined}
                >
                  Update selected
                </MenuItem>
                <MenuItem
                  disabled={!activeLayout || activeLayout.isDefault}
                  onClick={activeLayout && !activeLayout.isDefault ? () => {
                    void runLayoutAction(makeActiveLayoutDefault, `Default layout: ${activeLayout.name}`);
                    close();
                  } : undefined}
                >
                  Make selected default
                </MenuItem>
                <MenuItem
                  disabled={!activeLayout}
                  className="text-red-400"
                  onClick={activeLayout ? () => {
                    const name = activeLayout.name;
                    close();
                    void requestConfirm({
                      title: `Delete layout “${name}”?`,
                      description: "This saved layout will be removed from your workspace.",
                      confirmLabel: "Delete layout",
                      tone: "danger",
                    }).then((accepted) => {
                      if (accepted) void runLayoutAction(deleteActiveLayout, `Layout deleted: ${name}`);
                    });
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
                role="menuitemradio"
                aria-checked={chartLayoutPreset === preset}
                onClick={() => {
                  setChartLayoutPreset(preset as ChartLayoutPreset);
                  close();
                }}
              >
                <span className="flex-1">{label}</span>
                {chartLayoutPreset === preset && <span aria-hidden="true">✓</span>}
              </MenuItem>
            ))}
            <div className="my-1 border-t border-terminal-border" />
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Replay scope
            </div>
            <MenuItem
              active={replayLayoutMode === "single_chart"}
              role="menuitemradio"
              aria-checked={replayLayoutMode === "single_chart"}
              onClick={() => {
                setReplayLayoutMode("single_chart");
                close();
              }}
            >
              <span className="flex-1">Current chart</span>
              {replayLayoutMode === "single_chart" && <span aria-hidden="true">✓</span>}
            </MenuItem>
            <MenuItem
              active={replayLayoutMode === "all_charts"}
              role="menuitemradio"
              aria-checked={replayLayoutMode === "all_charts"}
              disabled={chartLayoutPreset === "single"}
              onClick={chartLayoutPreset === "single" ? undefined : () => {
                setReplayLayoutMode("all_charts");
                close();
              }}
            >
              <span className="flex-1">All charts</span>
              {replayLayoutMode === "all_charts" && <span aria-hidden="true">✓</span>}
            </MenuItem>
          </div>
        )}
      </Dropdown>
      </div>

      {desktopWorkspace === "trade" && (
        <div className="hidden min-w-0 items-center gap-2 text-[10px] text-ink-faint lg:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-bull" aria-hidden="true" />
          Common execution workspace · MT5 EA and native venue adapters
        </div>
      )}

      <div className="ml-auto flex h-10 items-center gap-1 rounded-xl border border-terminal-border bg-terminal-panel-2/45 p-1">
        <ConnectionBadge />
        <div className="h-5 w-px bg-terminal-border" />
        <button
          onClick={toggleAlertCenter}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
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
        {desktopWorkspace === "chart" && (
          <>
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
          </>
        )}
        <IconButton label="Theme" onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <IconButton label="Fullscreen" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
        <div className="h-5 w-px bg-terminal-border" />
        <AuthControl />
      </div>
      {dialog}
    </div>
  );
}
