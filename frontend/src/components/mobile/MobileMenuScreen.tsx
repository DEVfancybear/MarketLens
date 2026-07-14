"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { BarChart3, Bell, BookOpen, Bot, ChartNoAxesCombined, ChevronRight, ListTree, Moon, ScrollText, Settings, SlidersHorizontal, Sun, TrendingUp, UserRound } from "lucide-react";
import { setAlertCenterAtom, themeAtom, toggleThemeAtom } from "@/store/uiStore";
import { integrationSettingsOpenAtom } from "@/store/integrationSettingsStore";

export type MobileWorkspace =
  | "replay"
  | "journal"
  | "analytics"
  | "pine"
  | "indicators"
  | "chartTools"
  | "objects"
  | "logs"
  | "account";

export function MobileMenuScreen({ onOpen }: { onOpen: (workspace: MobileWorkspace) => void }) {
  const theme = useAtomValue(themeAtom);
  const toggleTheme = useSetAtom(toggleThemeAtom);
  const openSettings = useSetAtom(integrationSettingsOpenAtom);
  const openAlerts = useSetAtom(setAlertCenterAtom);
  return <section className="mobile-screen">
    <header className="mobile-screen-header"><div><small>WORKSPACE</small><h1>Tools & settings</h1></div></header>
    <div className="mobile-menu-group"><h2>Trading tools</h2>
      <MenuItem icon={<TrendingUp />} title="Market replay" subtitle="Practice historical sessions" onClick={() => onOpen("replay")} />
      <MenuItem icon={<ChartNoAxesCombined />} title="Indicators" subtitle="Store, favorites and Pine scripts" onClick={() => onOpen("indicators")} />
      <MenuItem icon={<BookOpen />} title="Trading journal" subtitle="Review notes and execution" onClick={() => onOpen("journal")} />
      <MenuItem icon={<BarChart3 />} title="Analytics" subtitle="Performance and risk metrics" onClick={() => onOpen("analytics")} />
      <MenuItem icon={<Bot />} title="Pine workspace" subtitle="Build custom indicators" onClick={() => onOpen("pine")} />
    </div>
    <div className="mobile-menu-group"><h2>Chart management</h2>
      <MenuItem icon={<SlidersHorizontal />} title="Chart tools" subtitle="SMC, layout, snapshot and display" onClick={() => onOpen("chartTools")} />
      <MenuItem icon={<ListTree />} title="Object tree" subtitle="Manage every drawing on the chart" onClick={() => onOpen("objects")} />
      <MenuItem icon={<Bell />} title="Alerts" subtitle="Create and manage price alerts" onClick={() => openAlerts(true)} />
      <MenuItem icon={<ScrollText />} title="Runtime logs" subtitle="Market, chart and sync activity" onClick={() => onOpen("logs")} />
    </div>
    <div className="mobile-menu-group"><h2>Preferences</h2>
      <MenuItem icon={<UserRound />} title="Account" subtitle="Identity and cloud workspace" onClick={() => onOpen("account")} />
      <MenuItem icon={theme === "dark" ? <Moon /> : <Sun />} title="Appearance" subtitle={`${theme === "dark" ? "Dark" : "Light"} theme`} onClick={() => toggleTheme()} />
      <MenuItem icon={<Settings />} title="Connections" subtitle="MT5 and notifications" onClick={() => openSettings(true)} />
    </div>
  </section>;
}

function MenuItem({ icon, title, subtitle, onClick }: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><span className="mobile-menu-icon">{icon}</span><span><strong>{title}</strong><small>{subtitle}</small></span><ChevronRight size={18} /></button>;
}
