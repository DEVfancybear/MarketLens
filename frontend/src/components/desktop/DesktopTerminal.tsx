"use client";

import { TerminalLayout } from "@/components/layout/TerminalLayout";
import { TopToolbar } from "@/components/toolbar/TopToolbar";
import { DrawingToolbar } from "@/components/toolbar/DrawingToolbar";
import { ChartArea } from "@/components/chart/ChartArea";
import { ChartPerformanceProfiler } from "@/components/chart/ChartPerformanceProfiler";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { BottomPanel } from "@/components/layout/BottomPanel";

/**
 * Desktop-only presentation root. Domain stores and chart services remain
 * shared, while every piece of terminal chrome lives behind this lazy chunk.
 */
export function DesktopTerminal() {
  return (
    <div className="desktop-terminal" data-platform="desktop">
      <TerminalLayout
        toolbar={<TopToolbar />}
        leftRail={<DrawingToolbar />}
        chart={
          <ChartPerformanceProfiler>
            <ChartArea />
          </ChartPerformanceProfiler>
        }
        watchlist={<RightSidebar />}
        bottom={<BottomPanel />}
      />
    </div>
  );
}
