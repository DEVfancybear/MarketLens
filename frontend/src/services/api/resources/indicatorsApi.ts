import { deleteJson, getJson, postJson, putJson } from "@/services/api/client";
import type { IndicatorConfig } from "@/types";

export interface BackendIndicatorPreset {
  id: string;
  indicatorType: string;
  scriptId?: string;
  config: IndicatorConfig;
  visible: boolean;
  position: number;
  clientId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IndicatorPresetWrite {
  indicatorType: string;
  scriptId?: string;
  config: IndicatorConfig;
  visible: boolean;
  position: number;
  clientId: string;
}

function writeFromConfig(config: IndicatorConfig, position: number): IndicatorPresetWrite {
  return {
    indicatorType: config.type,
    scriptId: config.scriptId,
    config,
    visible: config.visible !== false,
    position,
    clientId: config.id,
  };
}

export async function listIndicatorPresets(): Promise<BackendIndicatorPreset[]> {
  return getJson<BackendIndicatorPreset[]>("indicators");
}

export async function saveIndicatorPreset(
  config: IndicatorConfig,
  position: number,
): Promise<BackendIndicatorPreset> {
  return postJson<BackendIndicatorPreset>("indicators", writeFromConfig(config, position));
}

export async function replaceIndicatorPreset(
  idOrClientId: string,
  config: IndicatorConfig,
  position: number,
): Promise<BackendIndicatorPreset> {
  return putJson<BackendIndicatorPreset>(
    `indicators/${encodeURIComponent(idOrClientId)}`,
    writeFromConfig(config, position),
  );
}

export async function deleteIndicatorPreset(idOrClientId: string): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`indicators/${encodeURIComponent(idOrClientId)}`);
}
