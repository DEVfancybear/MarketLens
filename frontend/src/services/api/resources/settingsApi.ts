import { getJson, patchJson, putJson } from "@/services/api/client";

export type SettingsSection = Record<string, unknown>;

export interface SettingsDocument {
  ui: SettingsSection;
  smc: SettingsSection;
  chart: SettingsSection;
  notifications: SettingsSection;
}

export type SettingsPatch = Partial<SettingsDocument>;

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
