import { getJson, patchJson, putJson } from "../client";

export type SettingsSection = Record<string, unknown>;

export interface SettingsDocument {
  ui: SettingsSection;
  smc: SettingsSection;
  chart: SettingsSection;
  notifications: SettingsSection;
}

export type SettingsPatch = Partial<SettingsDocument>;

export interface FavoriteTimeframesResponse {
  timeframes: string[];
}

export async function getSettings(): Promise<SettingsDocument> {
  return getJson<SettingsDocument>("settings");
}

export async function replaceSettings(
  settings: SettingsDocument,
): Promise<SettingsDocument> {
  return putJson<SettingsDocument>("settings", settings);
}

export async function patchSettings(
  patch: SettingsPatch,
): Promise<SettingsDocument> {
  return patchJson<SettingsDocument>("settings", patch);
}

export async function getFavoriteTimeframes(): Promise<FavoriteTimeframesResponse> {
  return getJson<FavoriteTimeframesResponse>("settings/chart/favorite-timeframes");
}

export async function replaceFavoriteTimeframes(
  timeframes: string[],
): Promise<FavoriteTimeframesResponse> {
  return putJson<FavoriteTimeframesResponse>("settings/chart/favorite-timeframes", {
    timeframes,
  });
}
