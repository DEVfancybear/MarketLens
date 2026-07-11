import { deleteJson, getJson, postJson, putJson } from "../client";
import type {
  JournalEntry,
  ScreenshotPhase,
  ScreenshotRef,
} from "@/types";

export interface BackendScreenshot {
  id: string;
  journalEntryId: string;
  phase: ScreenshotPhase;
  storageKey?: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  contentType: string;
  createdAt: string;
}

export interface BackendJournalEntry {
  id: string;
  clientId?: string;
  symbol: string;
  side: "long" | "short";
  entryTime: string;
  exitTime?: string;
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  rr?: number;
  riskAmount?: number;
  notes?: string;
  tags: string[];
  positionId?: string;
  screenshots: BackendScreenshot[];
  createdAt: string;
  updatedAt: string;
}

export interface JournalFilters {
  symbol?: string;
  tag?: string;
  before?: string;
  limit?: number;
}

interface UploadURLResponse {
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
}

interface ViewURLResponse {
  url: string;
  expiresAt: string;
}

function epochSeconds(value?: string): number {
  if (!value) return 0;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis / 1000 : 0;
}

function isoTime(epochSecondsValue: number): string {
  return new Date(epochSecondsValue * 1000).toISOString();
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

export function localJournalToCreate(entry: JournalEntry) {
  return {
    clientId: entry.id,
    symbol: entry.symbol,
    side: entry.side,
    entryTime: isoTime(entry.entryTime),
    exitTime: entry.exitTime ? isoTime(entry.exitTime) : undefined,
    entryPrice: entry.entryPrice,
    exitPrice: entry.exitPrice,
    quantity: entry.quantity,
    pnl: entry.pnl,
    rr: entry.rr,
    riskAmount: entry.riskAmount,
    notes: entry.notes,
    tags: entry.tags ?? [],
  };
}

export function localJournalToUpdate(entry: JournalEntry) {
  const { clientId: _clientId, ...payload } = localJournalToCreate(entry);
  return payload;
}

async function screenshotToLocal(
  screenshot: BackendScreenshot,
): Promise<ScreenshotRef> {
  let thumb = "";
  try {
    thumb = (await getScreenshotViewURL(screenshot.id)).url;
  } catch {
    // Metadata remains useful even if object storage is temporarily unavailable.
  }
  return {
    id: screenshot.id,
    phase: screenshot.phase,
    thumb,
    createdAt: epochSeconds(screenshot.createdAt),
  };
}

export async function backendJournalToLocal(
  row: BackendJournalEntry,
): Promise<JournalEntry> {
  return {
    id: row.clientId || row.id,
    symbol: row.symbol,
    side: row.side,
    entryTime: epochSeconds(row.entryTime),
    exitTime: epochSeconds(row.exitTime),
    entryPrice: row.entryPrice,
    exitPrice: row.exitPrice ?? 0,
    quantity: row.quantity,
    pnl: row.pnl ?? 0,
    rr: row.rr ?? 0,
    riskAmount: row.riskAmount ?? 0,
    notes: row.notes,
    tags: row.tags ?? [],
    screenshots: await Promise.all(
      (row.screenshots ?? []).map(screenshotToLocal),
    ),
  };
}

export async function listJournal(
  filters: JournalFilters = {},
): Promise<JournalEntry[]> {
  const query = new URLSearchParams();
  if (filters.symbol) query.set("symbol", filters.symbol);
  if (filters.tag) query.set("tag", filters.tag);
  if (filters.before) query.set("before", filters.before);
  if (filters.limit) query.set("limit", String(filters.limit));
  const suffix = query.size ? `?${query}` : "";
  const rows = await getJson<BackendJournalEntry[]>(`journal${suffix}`);
  return Promise.all(rows.map(backendJournalToLocal));
}

export async function createJournalEntry(
  entry: JournalEntry,
): Promise<BackendJournalEntry> {
  return postJson<BackendJournalEntry>("journal", localJournalToCreate(entry));
}

export async function updateJournalEntry(
  entry: JournalEntry,
): Promise<BackendJournalEntry> {
  return putJson<BackendJournalEntry>(
    `journal/${encodePath(entry.id)}`,
    localJournalToUpdate(entry),
  );
}

export async function deleteJournalEntry(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`journal/${encodePath(id)}`);
}

export async function getScreenshotViewURL(
  id: string,
): Promise<ViewURLResponse> {
  return getJson<ViewURLResponse>(`screenshots/${encodePath(id)}`);
}

export async function deleteScreenshot(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`screenshots/${encodePath(id)}`);
}

export async function uploadJournalScreenshot(
  journalEntryId: string,
  phase: ScreenshotPhase,
  blob: Blob,
): Promise<ScreenshotRef> {
  const contentType = blob.type || "image/png";
  const upload = await postJson<UploadURLResponse>("screenshots/upload-url", {
    contentType,
  });
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });
  if (!response.ok) {
    throw new Error(`Screenshot upload failed (${response.status})`);
  }
  const dimensions = await imageDimensions(blob);
  const screenshot = await postJson<BackendScreenshot>("screenshots", {
    journalEntryId,
    phase,
    storageKey: upload.storageKey,
    contentType,
    sizeBytes: blob.size,
    ...dimensions,
  });
  const view = await getScreenshotViewURL(screenshot.id);
  return {
    id: screenshot.id,
    phase: screenshot.phase,
    thumb: view.url,
    createdAt: epochSeconds(screenshot.createdAt),
  };
}

async function imageDimensions(
  blob: Blob,
): Promise<{ width?: number; height?: number }> {
  if (typeof createImageBitmap !== "function") return {};
  try {
    const bitmap = await createImageBitmap(blob);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  } catch {
    return {};
  }
}
