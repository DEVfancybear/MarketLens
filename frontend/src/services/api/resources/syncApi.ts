import { getJson } from "@/services/api/client";
import type { SettingsDocument } from "./settingsApi";
import type { BackendWatchlist } from "./watchlistsApi";
import type { BackendDrawingTemplate } from "./drawingsApi";
import type { BackendIndicatorPreset } from "./indicatorsApi";
import type { BackendPineScript } from "./pineScriptsApi";
import type { BackendAlert, BackendAlertEvent } from "./alertsApi";
import type { BackendLayout } from "./layoutsApi";

export interface WorkspaceBootstrap {
  settings: SettingsDocument;
  watchlists: BackendWatchlist[];
  drawingTemplates: BackendDrawingTemplate[];
  indicators: BackendIndicatorPreset[];
  pineScripts: BackendPineScript[];
  alerts: BackendAlert[];
  triggeredAlerts: BackendAlert[];
  expiredAlerts?: BackendAlert[];
  history: BackendAlertEvent[];
  layouts: BackendLayout[];
}

export async function getWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  return getJson<WorkspaceBootstrap>("sync/bootstrap");
}
