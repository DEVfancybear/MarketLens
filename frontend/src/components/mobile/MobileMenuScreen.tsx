"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { BarChart3, Bell, BookOpen, Bot, ChartNoAxesCombined, ChevronRight, Languages, ListTree, Moon, ScrollText, Settings, SlidersHorizontal, Sun, TrendingUp, UserRound } from "lucide-react";
import { setAlertCenterAtom, themeAtom, toggleThemeAtom } from "@/store/uiStore";
import { integrationSettingsOpenAtom } from "@/store/integrationSettingsStore";
import { appLanguageAtom, setAppLanguageAtom } from "@/store/localeStore";
import { useI18n } from "@/hooks/useI18n";

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
  const { t } = useI18n();
  const theme = useAtomValue(themeAtom);
  const language = useAtomValue(appLanguageAtom);
  const toggleTheme = useSetAtom(toggleThemeAtom);
  const setLanguage = useSetAtom(setAppLanguageAtom);
  const openSettings = useSetAtom(integrationSettingsOpenAtom);
  const openAlerts = useSetAtom(setAlertCenterAtom);
  return <section className="mobile-screen">
    <header className="mobile-screen-header"><div><small>{t("mobile.workspace")}</small><h1>{t("mobile.toolsSettings")}</h1></div></header>
    <div className="mobile-menu-group"><h2>{t("mobile.tradingTools")}</h2>
      <MenuItem icon={<TrendingUp />} title={t("mobile.marketReplay")} subtitle={t("mobile.marketReplayHelp")} onClick={() => onOpen("replay")} />
      <MenuItem icon={<ChartNoAxesCombined />} title={t("toolbar.indicators")} subtitle={t("mobile.indicatorsHelp")} onClick={() => onOpen("indicators")} />
      <MenuItem icon={<BookOpen />} title={t("mobile.journal")} subtitle={t("mobile.journalHelp")} onClick={() => onOpen("journal")} />
      <MenuItem icon={<BarChart3 />} title={t("mobile.analytics")} subtitle={t("mobile.analyticsHelp")} onClick={() => onOpen("analytics")} />
      <MenuItem icon={<Bot />} title={t("mobile.pine")} subtitle={t("mobile.pineHelp")} onClick={() => onOpen("pine")} />
    </div>
    <div className="mobile-menu-group"><h2>{t("mobile.chartManagement")}</h2>
      <MenuItem icon={<SlidersHorizontal />} title={t("mobile.chartTools")} subtitle={t("mobile.chartToolsHelp")} onClick={() => onOpen("chartTools")} />
      <MenuItem icon={<ListTree />} title={t("mobile.objectTree")} subtitle={t("mobile.objectTreeHelp")} onClick={() => onOpen("objects")} />
      <MenuItem icon={<Bell />} title={t("toolbar.alerts")} subtitle={t("mobile.alertsHelp")} onClick={() => openAlerts(true)} />
      <MenuItem icon={<ScrollText />} title={t("mobile.logs")} subtitle={t("mobile.logsHelp")} onClick={() => onOpen("logs")} />
    </div>
    <div className="mobile-menu-group"><h2>{t("mobile.preferences")}</h2>
      <MenuItem icon={<UserRound />} title={t("mobile.account")} subtitle={t("mobile.accountHelp")} onClick={() => onOpen("account")} />
      <MenuItem icon={<Languages />} title={t("language.label")} subtitle={language === "en" ? "English" : "Tiếng Việt"} onClick={() => setLanguage(language === "en" ? "vi" : "en")} />
      <MenuItem icon={theme === "dark" ? <Moon /> : <Sun />} title={t("mobile.appearance")} subtitle={theme === "dark" ? t("mobile.darkTheme") : t("mobile.lightTheme")} onClick={() => toggleTheme()} />
      <MenuItem icon={<Settings />} title={t("mobile.connections")} subtitle={t("mobile.connectionsHelp")} onClick={() => openSettings(true)} />
    </div>
  </section>;
}

function MenuItem({ icon, title, subtitle, onClick }: { icon: React.ReactNode; title: string; subtitle: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><span className="mobile-menu-icon">{icon}</span><span><strong>{title}</strong><small>{subtitle}</small></span><ChevronRight size={18} /></button>;
}
