import { getJson } from "@/services/api/client";
import type { SettingsDocument } from "./settingsApi";
import type { BackendWatchlist } from "./watchlistsApi";
import type { BackendDrawingTemplate } from "./drawingsApi";

export interface WorkspaceBootstrap {
  settings: SettingsDocument;
  watchlists: BackendWatchlist[];
  drawingTemplates: BackendDrawingTemplate[];
  indicators: unknown[];
  pineScripts: unknown[];
  alerts: unknown[];
  layouts: unknown[];
}

export async function getWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  return getJson<WorkspaceBootstrap>("sync/bootstrap");
}
