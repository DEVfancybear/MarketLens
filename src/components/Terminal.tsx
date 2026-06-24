'use client';

import { TerminalLayout } from '@/components/layout/TerminalLayout';
import { TopToolbar } from '@/components/toolbar/TopToolbar';
import { DrawingToolbar } from '@/components/toolbar/DrawingToolbar';
import { ChartArea } from '@/components/chart/ChartArea';
import { Watchlist } from '@/components/watchlist/Watchlist';
import { BottomPanel } from '@/components/layout/BottomPanel';
import { GlobalRuntime } from '@/components/layout/GlobalRuntime';
import { Splash } from '@/components/layout/Splash';
import { useStoreHydration } from '@/hooks/useStoreHydration';

/**
 * The full client-only trading terminal. Imported via `dynamic(..., {ssr:false})`
 * so none of its browser-dependent subtree (charts, canvases, localStorage) is
 * server-rendered. Render is additionally delayed until Zustand stores have
 * hydrated their persisted state.
 */
export function Terminal() {
  const hydrated = useStoreHydration();
  if (!hydrated) return <Splash />;

  return (
    <>
      <GlobalRuntime />
      <TerminalLayout
        toolbar={<TopToolbar />}
        leftRail={<DrawingToolbar />}
        chart={<ChartArea />}
        watchlist={<Watchlist />}
        bottom={<BottomPanel />}
      />
    </>
  );
}
