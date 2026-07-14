"use client";

import { useCallback } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Bell,
  Check,
  Clipboard,
  Copy,
  Download,
  Eraser,
  Grid3X3,
  LayoutGrid,
  ListTree,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Plug,
  RotateCcw,
  ScrollText,
  Star,
  Sun,
  Trash2,
  WalletCards,
} from "lucide-react";
import {
  candlesAtom,
  clearIndicatorsAtom,
  drawColorAtom,
  addDrawingAtom,
  indicatorsAtom,
  symbolAtom,
} from "@/store/chartStore";
import {
  fullscreenAtom,
  gridVisibleAtom,
  logAtom,
  setFullscreenAtom,
  themeAtom,
  toggleGridAtom,
  toggleThemeAtom,
} from "@/store/uiStore";
import { backendSessionAtom } from "@/store/authStore";
import { integrationSettingsOpenAtom } from "@/store/integrationSettingsStore";
import { smcSettingsAtom, toggleSmcAtom } from "@/store/smcStore";
import {
  activeLayoutIdAtom,
  createCurrentLayoutAtom,
  deleteActiveLayoutAtom,
  layoutsAtom,
  loadLayoutAtom,
  makeActiveLayoutDefaultAtom,
  overwriteActiveLayoutAtom,
} from "@/store/layoutStore";
import {
  chartLayoutPresetAtom,
  replayLayoutModeAtom,
  setChartLayoutPresetAtom,
  setReplayLayoutModeAtom,
  type ChartLayoutPreset,
} from "@/store/replayLayoutStore";
import { useAlertStore } from "@/store/alertStore";
import { useConnectionMeta } from "@/hooks/useConnectionStatus";
import { useChartSnapshotActions } from "@/hooks/useChartSnapshotActions";
import { useDrawingBulkActions } from "@/components/chart/drawing/bulk/useDrawingBulkActions";
import { resetChartView } from "@/components/chart/chartRegistry";
import { SMC_MENU_ITEMS } from "@/components/chart/smcMenuItems";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
import { fmtPrice } from "@/utils/format";
import { uid } from "@/utils/id";
import { cn } from "@/utils/cn";

export interface MobileChartToolsWorkspaceProps {
  onOpenAlerts: () => void;
  onOpenObjects: () => void;
  onOpenLogs: () => void;
  onOpenTrade: () => void;
}

/** Touch command center for desktop chart commands that are not top-level mobile navigation. */
export function MobileChartToolsWorkspace({
  onOpenAlerts,
  onOpenObjects,
  onOpenLogs,
  onOpenTrade,
}: MobileChartToolsWorkspaceProps) {
  const theme = useAtomValue(themeAtom);
  const grid = useAtomValue(gridVisibleAtom);
  const fullscreen = useAtomValue(fullscreenAtom);
  const symbol = useAtomValue(symbolAtom);
  const candles = useAtomValue(candlesAtom);
  const indicators = useAtomValue(indicatorsAtom);
  const drawColor = useAtomValue(drawColorAtom);
  const smc = useAtomValue(smcSettingsAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const layouts = useAtomValue(layoutsAtom);
  const activeLayoutId = useAtomValue(activeLayoutIdAtom);
  const chartLayout = useAtomValue(chartLayoutPresetAtom);
  const replayLayout = useAtomValue(replayLayoutModeAtom);
  const alertCount = useAlertStore((state) => state.alerts.length);
  const connection = useConnectionMeta();
  const snapshot = useChartSnapshotActions();
  const bulk = useDrawingBulkActions();
  const toggleTheme = useSetAtom(toggleThemeAtom);
  const toggleGrid = useSetAtom(toggleGridAtom);
  const setFullscreen = useSetAtom(setFullscreenAtom);
  const setConnectionsOpen = useSetAtom(integrationSettingsOpenAtom);
  const toggleSmc = useSetAtom(toggleSmcAtom);
  const addDrawing = useSetAtom(addDrawingAtom);
  const clearIndicators = useSetAtom(clearIndicatorsAtom);
  const log = useSetAtom(logAtom);
  const loadLayout = useSetAtom(loadLayoutAtom);
  const createLayout = useSetAtom(createCurrentLayoutAtom);
  const overwriteLayout = useSetAtom(overwriteActiveLayoutAtom);
  const makeDefault = useSetAtom(makeActiveLayoutDefaultAtom);
  const deleteLayout = useSetAtom(deleteActiveLayoutAtom);
  const setChartLayout = useSetAtom(setChartLayoutPresetAtom);
  const setReplayLayout = useSetAtom(setReplayLayoutModeAtom);

  const last = candles[candles.length - 1];
  const precision = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const activeLayout = layouts.find((item) => item.id === activeLayoutId);

  const runLayoutAction = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      try {
        await action();
        log("info", success);
      } catch (error) {
        log("error", `Layout action failed: ${userFacingErrorMessage(error, "request failed")}`);
      }
    },
    [log],
  );

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen?.();
        setFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setFullscreen(false);
      }
    } catch (error) {
      log("warn", userFacingErrorMessage(error, "Fullscreen is unavailable"));
    }
  };

  const copyCurrentPrice = async () => {
    if (!last) return;
    const value = fmtPrice(last.close, precision);
    try {
      await navigator.clipboard.writeText(value);
      log("info", `Copied ${value}`);
    } catch (error) {
      log("warn", userFacingErrorMessage(error, "Copy price is unavailable"));
    }
  };

  const drawCurrentPrice = () => {
    if (!last) return;
    addDrawing({
      id: uid("dw"),
      tool: "horizontal",
      color: drawColor,
      lineWidth: 1.5,
      points: [{ time: last.time, price: last.close }],
    });
    log("info", `Horizontal line added at ${fmtPrice(last.close, precision)}`);
  };

  return (
    <div className="mobile-tools-workspace">
      <div className="mobile-connection-summary">
        <span className={cn("mobile-status-dot", (connection.status === "connecting" || connection.status === "reconnecting") && "is-pulsing")} style={{ backgroundColor: connection.color }} />
        <span><strong>Market data</strong><small>{connection.label}</small></span>
        <button type="button" onClick={() => setConnectionsOpen(true)}><Plug size={17} />Connections</button>
      </div>

      <ToolSection title="Chart actions" subtitle={`${symbol}${last ? ` · ${fmtPrice(last.close, precision)}` : ""}`}>
        <div className="mobile-command-grid">
          <Command icon={<Bell />} label="Alerts" detail={`${alertCount} configured`} onClick={onOpenAlerts} />
          <Command icon={<WalletCards />} label="Order ticket" detail="Trade current market" onClick={onOpenTrade} />
          <Command icon={<Minus />} label="Price line" detail="At latest close" disabled={!last} onClick={drawCurrentPrice} />
          <Command icon={<Copy />} label="Copy price" detail="Latest close" disabled={!last} onClick={() => void copyCurrentPrice()} />
          <Command icon={<ListTree />} label="Object tree" detail={`${bulk.drawings.length} drawings`} onClick={onOpenObjects} />
          <Command icon={<ScrollText />} label="Runtime logs" detail="Inspect activity" onClick={onOpenLogs} />
        </div>
      </ToolSection>

      <ToolSection title="Chart display" subtitle="Shared settings">
        <div className="mobile-setting-list">
          <SettingRow icon={<Grid3X3 />} title="Grid lines" subtitle="Show chart grid" active={grid} onClick={() => toggleGrid()} />
          <SettingRow icon={theme === "dark" ? <Sun /> : <Moon />} title={theme === "dark" ? "Light theme" : "Dark theme"} subtitle={`Currently ${theme}`} onClick={() => toggleTheme()} />
          <SettingRow icon={<RotateCcw />} title="Reset chart view" subtitle="Fit price and time scale" onClick={() => { if (resetChartView()) log("info", "Chart view reset"); }} />
          <SettingRow icon={fullscreen ? <Minimize2 /> : <Maximize2 />} title={fullscreen ? "Exit fullscreen" : "Fullscreen"} subtitle="Use the entire display" onClick={() => void toggleFullscreen()} />
        </div>
      </ToolSection>

      <ToolSection title="Smart Money Concepts" subtitle="Overlay visibility">
        <div className="mobile-smc-grid">
          {SMC_MENU_ITEMS.map((item) => (
            <button key={item.key} type="button" aria-pressed={smc[item.key]} className={cn(smc[item.key] && "is-active")} onClick={() => toggleSmc(item.key)}>
              <span style={{ background: smc[item.key] ? item.color : "transparent", borderColor: item.color }}>{smc[item.key] && <Check size={11} />}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </div>
      </ToolSection>

      <ToolSection title="Snapshot" subtitle="Export the shared chart canvas">
        <div className="mobile-snapshot-actions">
          <button type="button" onClick={() => void snapshot.download()}><Download size={18} /><span><strong>Download image</strong><small>Save PNG to this device</small></span></button>
          <button type="button" onClick={() => void snapshot.copy()}><Clipboard size={18} /><span><strong>Copy image</strong><small>Copy PNG to clipboard</small></span></button>
        </div>
      </ToolSection>

      <ToolSection title="Saved layouts" subtitle={backendSession ? "Synced to your account" : "Sign in to save layouts"}>
        {backendSession && (
          <>
            <div className="mobile-layout-list">
              {layouts.length === 0 && <p>No saved layouts yet.</p>}
              {layouts.map((layout) => (
                <button key={layout.id} type="button" aria-pressed={layout.id === activeLayoutId} className={cn(layout.id === activeLayoutId && "is-active")} onClick={() => {
                  try { loadLayout(layout); log("info", `Layout loaded: ${layout.name}`); }
                  catch (error) { log("error", `Layout load failed: ${userFacingErrorMessage(error, "invalid snapshot")}`); }
                }}>
                  <LayoutGrid size={18} /><span><strong>{layout.name}</strong><small>{layout.symbol ?? "Workspace"} · {layout.timeframe ?? "Saved interval"}</small></span>{layout.isDefault && <Star size={16} fill="currentColor" />}
                </button>
              ))}
            </div>
            <div className="mobile-layout-actions">
              <button type="button" onClick={() => {
                const name = window.prompt("Layout name", activeLayout?.name ?? "My layout")?.trim();
                if (name) void runLayoutAction(() => createLayout({ name, isDefault: layouts.length === 0 }), `Layout saved: ${name}`);
              }}>Save current</button>
              <button type="button" disabled={!activeLayout} onClick={() => activeLayout && void runLayoutAction(overwriteLayout, `Layout updated: ${activeLayout.name}`)}>Update</button>
              <button type="button" disabled={!activeLayout || activeLayout.isDefault} onClick={() => activeLayout && void runLayoutAction(makeDefault, `Default layout: ${activeLayout.name}`)}>Make default</button>
              <button type="button" className="is-danger" disabled={!activeLayout} onClick={() => {
                if (activeLayout && window.confirm(`Delete layout “${activeLayout.name}”?`)) void runLayoutAction(deleteLayout, `Layout deleted: ${activeLayout.name}`);
              }}>Delete</button>
            </div>
          </>
        )}
        <div className="mobile-layout-presets">
          <h4>Chart arrangement</h4>
          <div role="radiogroup" aria-label="Chart arrangement">
            {([[
              "single", "Single",
            ], ["two_horizontal", "2 horizontal"], ["two_vertical", "2 vertical"], ["grid_2x2", "Grid 2×2"]] as [ChartLayoutPreset, string][]).map(([preset, label]) => (
              <button key={preset} type="button" role="radio" aria-checked={chartLayout === preset} className={cn(chartLayout === preset && "is-active")} onClick={() => setChartLayout(preset)}>{label}</button>
            ))}
          </div>
          <h4>Replay scope</h4>
          <div role="radiogroup" aria-label="Replay scope">
            <button type="button" role="radio" aria-checked={replayLayout === "single_chart"} className={cn(replayLayout === "single_chart" && "is-active")} onClick={() => setReplayLayout("single_chart")}>Current chart</button>
            <button type="button" role="radio" disabled={chartLayout === "single"} aria-checked={replayLayout === "all_charts"} className={cn(replayLayout === "all_charts" && "is-active")} onClick={() => setReplayLayout("all_charts")}>All charts</button>
          </div>
        </div>
      </ToolSection>

      {(bulk.drawings.length > 0 || indicators.length > 0) && (
        <ToolSection title="Clear chart" subtitle="Destructive actions">
          <div className="mobile-clear-actions">
            <button type="button" disabled={!bulk.drawings.length} onClick={() => { if (window.confirm(`Remove all ${bulk.drawings.length} drawings?`)) bulk.remove({ kind: "all" }); }}><Eraser size={18} />Remove {bulk.drawings.length} drawings</button>
            <button type="button" disabled={!indicators.length} onClick={() => { if (window.confirm(`Remove all ${indicators.length} indicators?`)) clearIndicators(); }}><Trash2 size={18} />Remove {indicators.length} indicators</button>
          </div>
        </ToolSection>
      )}
    </div>
  );
}

function ToolSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="mobile-tools-section"><header><div><h3>{title}</h3><p>{subtitle}</p></div></header>{children}</section>;
}

function Command({ icon, label, detail, disabled, onClick }: { icon: React.ReactNode; label: string; detail: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick}><span>{icon}</span><strong>{label}</strong><small>{detail}</small></button>;
}

function SettingRow({ icon, title, subtitle, active, onClick }: { icon: React.ReactNode; title: string; subtitle: string; active?: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick}><span>{icon}</span><span><strong>{title}</strong><small>{subtitle}</small></span>{active !== undefined && <span className={cn("mobile-switch", active && "is-active")}><i /></span>}</button>;
}
