import {
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from "@/services/api/client";
import type { Drawing, DrawingTemplate } from "@/types";

export interface BackendDrawing {
  id: string;
  symbol: string;
  toolType: string;
  payload: Drawing;
  locked: boolean;
  hidden: boolean;
  clientId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackendDrawingWrite {
  symbol: string;
  toolType: string;
  payload: Drawing;
  locked?: boolean;
  hidden?: boolean;
  clientId?: string;
}

export interface BackendDrawingDelete {
  id?: string;
  clientId?: string;
  symbol?: string;
}

export interface BackendDrawingBatchRequest {
  upserts: BackendDrawingWrite[];
  deletes: BackendDrawingDelete[];
}

export interface BackendDrawingBatchResponse {
  upserted: BackendDrawing[];
  deleted: number;
}

export interface BackendDrawingTemplate {
  id: string;
  name: string;
  family: DrawingTemplate["family"];
  style: Partial<DrawingTemplate>;
  createdAt: string;
  updatedAt: string;
}

export interface BackendDrawingTemplateWrite {
  name: string;
  family: DrawingTemplate["family"];
  style: Partial<DrawingTemplate>;
}

export interface BackendDrawingToolFavorites {
  tools: string[];
  updatedAt: string;
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value);
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

export async function listDrawings(symbol: string): Promise<BackendDrawing[]> {
  return getJson<BackendDrawing[]>(`drawings?symbol=${encodeQuery(symbol)}`);
}

export async function createDrawing(
  payload: BackendDrawingWrite,
): Promise<BackendDrawing> {
  return postJson<BackendDrawing>("drawings", payload);
}

export async function replaceDrawing(
  id: string,
  payload: BackendDrawingWrite,
): Promise<BackendDrawing> {
  return putJson<BackendDrawing>(`drawings/${encodePath(id)}`, payload);
}

export async function patchDrawing(
  id: string,
  payload: Partial<BackendDrawingWrite>,
): Promise<BackendDrawing> {
  return patchJson<BackendDrawing>(`drawings/${encodePath(id)}`, payload);
}

export async function deleteDrawing(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`drawings/${encodePath(id)}`);
}

export async function syncDrawingsBatch(
  payload: BackendDrawingBatchRequest,
): Promise<BackendDrawingBatchResponse> {
  return postJson<BackendDrawingBatchResponse>("drawings/batch", payload);
}

export async function listDrawingTemplates(): Promise<BackendDrawingTemplate[]> {
  return getJson<BackendDrawingTemplate[]>("drawing-templates");
}

export async function saveDrawingTemplate(
  payload: BackendDrawingTemplateWrite,
): Promise<BackendDrawingTemplate> {
  return postJson<BackendDrawingTemplate>("drawing-templates", payload);
}

export async function updateDrawingTemplate(
  id: string,
  payload: BackendDrawingTemplateWrite,
): Promise<BackendDrawingTemplate> {
  return putJson<BackendDrawingTemplate>(
    `drawing-templates/${encodePath(id)}`,
    payload,
  );
}

export async function deleteDrawingTemplate(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`drawing-templates/${encodePath(id)}`);
}

export async function getDrawingToolFavorites(): Promise<BackendDrawingToolFavorites> {
  return getJson<BackendDrawingToolFavorites>("drawing-tool-favorites");
}

export async function replaceDrawingToolFavorites(
  tools: string[],
): Promise<BackendDrawingToolFavorites> {
  return putJson<BackendDrawingToolFavorites>("drawing-tool-favorites", {
    tools,
  });
}
