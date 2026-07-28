"use client";

import dynamic from "next/dynamic";
import { IndicatorSettingsDialog } from "@/components/toolbar/IndicatorSettingsDialog";
import { PositionSettingsDialog } from "@/components/chart/PositionSettingsDialog";
import { ObjectSettingsDialog } from "@/components/chart/ObjectSettingsDialog";
import { GlobalRuntime } from "@/components/layout/GlobalRuntime";
import { Splash } from "@/components/layout/Splash";
import { Toaster } from "@/components/notifications/Toaster";
import { AlertCenter } from "@/components/alerts/AlertCenter";
import { AlertEditDialog } from "@/components/alerts/AlertEditDialog";
import { useStoreHydration } from "@/hooks/useStoreHydration";
import { useHotkeys } from "@/hooks/useHotkeys";
import { AppSettingsDialog } from "@/components/settings/AppSettingsDialog";
import { DrawingAlertDialog } from "@/components/chart/drawing/alerts/DrawingAlertDialog";
import { useTerminalPlatform } from "@/hooks/useTerminalPlatform";
import { TradeSecurityDialog } from "@/components/security/TradeSecurityDialog";
import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { appLanguageAtom, hydrateAppLanguageAtom } from "@/store/localeStore";
import { useDocumentLocalization } from "@/i18n/documentLocalization";

const DesktopTerminal = dynamic(
  () => import("@/components/desktop/DesktopTerminal").then((module) => module.DesktopTerminal),
  { ssr: false, loading: () => <Splash /> },
);

const MobileTerminal = dynamic(
  () => import("@/components/mobile/MobileTerminal").then((module) => module.MobileTerminal),
  { ssr: false, loading: () => <Splash /> },
);

/**
 * The full client-only trading terminal. Imported via `dynamic(..., {ssr:false})`
 * so none of its browser-dependent subtree (charts, canvases, localStorage) is
 * server-rendered. Render is additionally delayed until Zustand stores have
 * hydrated their persisted state.
 */
export function Terminal() {
  const hydrated = useStoreHydration();
  const platform = useTerminalPlatform();
  const language = useAtomValue(appLanguageAtom);
  const hydrateLanguage = useSetAtom(hydrateAppLanguageAtom);
  useHotkeys();
  useDocumentLocalization(language);

  useEffect(() => {
    hydrateLanguage();
  }, [hydrateLanguage]);

  if (!hydrated) return <Splash />;

  return (
    <>
      <GlobalRuntime />
      {platform === "desktop" ? <DesktopTerminal /> : <MobileTerminal />}
      <AlertCenter />
      <AlertEditDialog />
      <IndicatorSettingsDialog />
      <PositionSettingsDialog />
      <ObjectSettingsDialog />
      <AppSettingsDialog />
      <DrawingAlertDialog />
      <TradeSecurityDialog />
      <Toaster />
    </>
  );
}
