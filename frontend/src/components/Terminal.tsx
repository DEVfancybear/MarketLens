"use client";

import { TerminalLayout } from "@/components/layout/TerminalLayout";
import { TopToolbar } from "@/components/toolbar/TopToolbar";
import { DrawingToolbar } from "@/components/toolbar/DrawingToolbar";
import { IndicatorSettingsDialog } from "@/components/toolbar/IndicatorSettingsDialog";
import { PositionSettingsDialog } from "@/components/chart/PositionSettingsDialog";
import { ObjectSettingsDialog } from "@/components/chart/ObjectSettingsDialog";
import { ChartArea } from "@/components/chart/ChartArea";
import { Watchlist } from "@/components/watchlist/Watchlist";
import { BottomPanel } from "@/components/layout/BottomPanel";
import { GlobalRuntime } from "@/components/layout/GlobalRuntime";
import { Splash } from "@/components/layout/Splash";
import { Toaster } from "@/components/notifications/Toaster";
import { AlertCenter } from "@/components/alerts/AlertCenter";
import { AlertEditDialog } from "@/components/alerts/AlertEditDialog";
import { useStoreHydration } from "@/hooks/useStoreHydration";
import { useHotkeys } from "@/hooks/useHotkeys";
import { ChartPerformanceProfiler } from "@/components/chart/ChartPerformanceProfiler";
import { AppSettingsDialog } from "@/components/settings/AppSettingsDialog";

/**
 * The full client-only trading terminal. Imported via `dynamic(..., {ssr:false})`
 * so none of its browser-dependent subtree (charts, canvases, localStorage) is
 * server-rendered. Render is additionally delayed until Zustand stores have
 * hydrated their persisted state.
 */
export function Terminal() {
  const hydrated = useStoreHydration();
  useHotkeys();

  if (!hydrated) return <Splash />;

  return (
    <>
      <GlobalRuntime />
      <TerminalLayout
        toolbar={<TopToolbar />}
        leftRail={<DrawingToolbar />}
        chart={<ChartPerformanceProfiler><ChartArea /></ChartPerformanceProfiler>}
        watchlist={<Watchlist />}
        bottom={<BottomPanel />}
      />
      <AlertCenter />
      <AlertEditDialog />
      <IndicatorSettingsDialog />
      <PositionSettingsDialog />
      <ObjectSettingsDialog />
      <AppSettingsDialog />
      <Toaster />
    </>
  );
}
