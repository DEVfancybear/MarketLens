"use client";

import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { TerminalLayout } from "@/components/layout/TerminalLayout";
import { TopToolbar } from "@/components/toolbar/TopToolbar";
import { DrawingToolbar } from "@/components/toolbar/DrawingToolbar";
import { ChartLayoutWorkspace } from "@/components/chart/ChartLayoutWorkspace";
import { ChartPerformanceProfiler } from "@/components/chart/ChartPerformanceProfiler";
import { ChartTaskTabs } from "@/components/chart/ChartTaskTabs";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { BottomPanel } from "@/components/layout/BottomPanel";
import { TradeWorkspace } from "@/components/trade/TradeWorkspace";
import {
  desktopWorkspaceAtom,
  syncDesktopWorkspaceFromLocationAtom,
} from "@/store/uiStore";
import { chartTaskTabsAtom } from "@/store/chartTaskTabsRuntimeStore";

/**
 * Desktop-only presentation root. Domain stores and chart services remain
 * shared, while every piece of terminal chrome lives behind this lazy chunk.
 */
export function DesktopTerminal() {
  const workspace = useAtomValue(desktopWorkspaceAtom);
  const chartTaskTabs = useAtomValue(chartTaskTabsAtom);
  const syncWorkspace = useSetAtom(syncDesktopWorkspaceFromLocationAtom);

  useEffect(() => {
    const sync = () => syncWorkspace(window.location.search);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [syncWorkspace]);

  if (workspace === "trade") {
    return (
      <div
        className="desktop-terminal flex h-dvh w-screen flex-col overflow-clip bg-terminal-bg"
        data-platform="desktop"
      >
        <div className="h-14 shrink-0 border-b border-terminal-border bg-terminal-panel/95 shadow-[0_1px_0_rgba(255,255,255,.025)] backdrop-blur-xl">
          <TopToolbar />
        </div>
        <div className="min-h-0 flex-1">
          <TradeWorkspace />
        </div>
      </div>
    );
  }

  return (
    <div className="desktop-terminal" data-platform="desktop">
      <TerminalLayout
        toolbar={<TopToolbar />}
        leftRail={<DrawingToolbar />}
        chart={
          <div className="flex h-full min-h-0 flex-col">
            <ChartTaskTabs />
            <div
              id="chart-task-panel"
              role="tabpanel"
              aria-labelledby={`chart-task-tab-${chartTaskTabs.activeTaskId}`}
              className="min-h-0 flex-1"
            >
              <ChartPerformanceProfiler>
                <ChartLayoutWorkspace />
              </ChartPerformanceProfiler>
            </div>
          </div>
        }
        watchlist={<RightSidebar />}
        bottom={<BottomPanel />}
      />
    </div>
  );
}
