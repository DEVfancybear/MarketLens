"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Brush, ChartCandlestick, List, Menu, Play, WalletCards } from "lucide-react";
import { ChartArea } from "@/components/chart/ChartArea";
import { ChartPerformanceProfiler } from "@/components/chart/ChartPerformanceProfiler";
import { MobileSheet } from "./MobileSheet";
import { MobileSymbolPicker } from "./MobileSymbolPicker";
import { MobileTimeframeBar } from "./MobileTimeframeBar";
import { MobileMarkets } from "./MobileMarkets";
import { MobileDrawingPalette } from "./MobileDrawingPalette";
import { MobileTradeScreen } from "./MobileTradeScreen";
import { MobilePortfolioScreen } from "./MobilePortfolioScreen";
import { MobileMenuScreen, type MobileWorkspace } from "./MobileMenuScreen";
import { MobileReplayWorkspace } from "./MobileReplayWorkspace";
import { MobileJournalWorkspace } from "./MobileJournalWorkspace";
import { MobileAnalyticsWorkspace } from "./MobileAnalyticsWorkspace";
import { MobilePineWorkspace } from "./MobilePineWorkspace";

type MobileScreen = "chart" | "markets" | "trade" | "portfolio" | "menu";
type Surface = "draw" | MobileWorkspace | null;

export function MobileTerminal() {
  const [screen, setScreen] = useState<MobileScreen>("chart");
  const [surface, setSurface] = useState<Surface>(null);
  const surfaceRef = useRef<Surface>(null);

  useEffect(() => {
    surfaceRef.current = surface;
  }, [surface]);

  useEffect(() => {
    const handlePopState = () => {
      if (surfaceRef.current) setSurface(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openSurface = useCallback((next: Exclude<Surface, null>) => {
    window.history.pushState({ ...window.history.state, smcMobileSurface: next }, "");
    setSurface(next);
  }, []);

  const closeSurface = useCallback(() => {
    if (window.history.state?.smcMobileSurface) window.history.back();
    else setSurface(null);
  }, []);

  return (
    <main className="mobile-terminal" data-platform="mobile">
      <div className="mobile-app-content" data-mobile-app-content aria-hidden={surface ? true : undefined}>
        {screen === "chart" && (
          <div className="mobile-chart-screen">
            <header className="mobile-topbar">
              <div className="mobile-brand" aria-label="SMC Terminal"><span><ChartCandlestick size={19} /></span></div>
              <MobileSymbolPicker />
              <button type="button" className="mobile-avatar" aria-label="Account">N</button>
            </header>
            <MobileTimeframeBar />
            <div className="mobile-chart" aria-label="Interactive price chart">
              <ChartPerformanceProfiler><ChartArea /></ChartPerformanceProfiler>
              <div className="mobile-chart-actions">
                <button type="button" onClick={() => openSurface("draw")}><Brush size={18} />Draw</button>
                <button type="button" onClick={() => openSurface("replay")}><Play size={18} />Replay</button>
              </div>
            </div>
          </div>
        )}
        {screen === "markets" && <MobileMarkets onOpenChart={() => setScreen("chart")} />}
        {screen === "trade" && <MobileTradeScreen />}
        {screen === "portfolio" && <MobilePortfolioScreen />}
        {screen === "menu" && <MobileMenuScreen onOpen={openSurface} />}
        <nav className="mobile-bottom-nav" aria-label="Trading workspace">
          <NavButton label="Chart" icon={<BarChart3 />} active={screen === "chart"} onClick={() => setScreen("chart")} />
          <NavButton label="Markets" icon={<List />} active={screen === "markets"} onClick={() => setScreen("markets")} />
          <NavButton label="Trade" icon={<WalletCards />} active={screen === "trade"} onClick={() => setScreen("trade")} />
          <NavButton label="Portfolio" icon={<ChartCandlestick />} active={screen === "portfolio"} onClick={() => setScreen("portfolio")} />
          <NavButton label="Menu" icon={<Menu />} active={screen === "menu"} onClick={() => setScreen("menu")} />
        </nav>
      </div>

      {surface === "draw" && (
        <MobileSheet title="Drawing tools" onClose={closeSurface}>
          <MobileDrawingPalette onDone={closeSurface} />
        </MobileSheet>
      )}
      {surface && surface !== "draw" && (
        <MobileSheet title={workspaceTitle(surface)} onClose={closeSurface} fullscreen>
          <div className="mobile-workspace-content">
            {surface === "replay" && (
              <MobileReplayWorkspace returnToChart={() => { closeSurface(); setScreen("chart"); }} />
            )}
            {surface === "journal" && <MobileJournalWorkspace />}
            {surface === "analytics" && <MobileAnalyticsWorkspace />}
            {surface === "pine" && <MobilePineWorkspace />}
          </div>
        </MobileSheet>
      )}
    </main>
  );
}

function NavButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label={label} aria-current={active ? "page" : undefined} className={active ? "is-active" : undefined}><span aria-hidden="true">{icon}</span><span>{label}</span></button>;
}

function workspaceTitle(surface: Exclude<Surface, "draw" | null>): string {
  return surface === "replay" ? "Market replay" : surface === "journal" ? "Trading journal" : surface === "analytics" ? "Performance analytics" : "Pine workspace";
}
