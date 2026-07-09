import { deleteJson, getJson, postJson, putJson } from "@/services/api/client";
import type { CustomIndicatorScript } from "@/types";

export interface BackendPineScript {
  id: string;
  name: string;
  sourceCode?: string;
  favorite: boolean;
  meta?: Record<string, unknown>;
  clientId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PineScriptWrite {
  name?: string;
  sourceCode?: string;
  favorite?: boolean;
  meta?: Record<string, unknown>;
  clientId?: string;
}

export function backendPineScriptToLocal(row: BackendPineScript): CustomIndicatorScript {
  return {
    id: row.clientId || row.id,
    name: row.name,
    sourceCode: row.sourceCode ?? "",
    favorite: row.favorite,
    createdAt: Date.parse(row.createdAt) || Date.now(),
    updatedAt: Date.parse(row.updatedAt) || Date.now(),
  };
}

function writeFromScript(script: CustomIndicatorScript): PineScriptWrite {
  return {
    name: script.name,
    sourceCode: script.sourceCode,
    favorite: script.favorite,
    clientId: script.id,
  };
}

export async function listPineScripts(): Promise<BackendPineScript[]> {
  return getJson<BackendPineScript[]>("pine-scripts");
}

export async function getPineScript(idOrClientId: string): Promise<BackendPineScript> {
  return getJson<BackendPineScript>(`pine-scripts/${encodeURIComponent(idOrClientId)}`);
}

export async function savePineScriptRemote(
  script: CustomIndicatorScript,
): Promise<BackendPineScript> {
  return postJson<BackendPineScript>("pine-scripts", writeFromScript(script));
}

export async function updatePineScriptRemote(
  idOrClientId: string,
  patch: PineScriptWrite,
): Promise<BackendPineScript> {
  return putJson<BackendPineScript>(
    `pine-scripts/${encodeURIComponent(idOrClientId)}`,
    patch,
  );
}

export async function deletePineScriptRemote(
  idOrClientId: string,
): Promise<{ ok: boolean }> {
  return deleteJson<{ ok: boolean }>(`pine-scripts/${encodeURIComponent(idOrClientId)}`);
}
