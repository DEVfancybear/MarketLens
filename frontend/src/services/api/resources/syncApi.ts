import { getJson } from "@/services/api/client";
import type { SettingsDocument } from "./settingsApi";
import type { BackendWatchlist } from "./watchlistsApi";

export interface WorkspaceBootstrap {
  settings: SettingsDocument;
  watchlists: BackendWatchlist[];
  drawingTemplates: unknown[];
  indicators: unknown[];
  pineScripts: unknown[];
  alerts: unknown[];
  layouts: unknown[];
}

export async function getWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  return getJson<WorkspaceBootstrap>("sync/bootstrap");
}
