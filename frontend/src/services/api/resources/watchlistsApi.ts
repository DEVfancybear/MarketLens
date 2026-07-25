import {
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from "@/services/api/client";

export interface BackendWatchlistSection {
  id: string;
  title: string;
  index: number;
}

export interface BackendWatchlist {
  id: string;
  name: string;
  position: number;
  symbols: string[];
  sections?: BackendWatchlistSection[];
  shared?: boolean;
  active?: boolean;
  sortKey?: "manual" | "symbol" | "price" | "change" | "changeAbs" | "volume";
  sortDir?: "asc" | "desc";
}

export interface UpdateWatchlistPayload {
  name?: string;
  position?: number;
  shared?: boolean;
  sortKey?: "manual" | "symbol" | "price" | "change" | "changeAbs" | "volume";
  sortDir?: "asc" | "desc";
}

export interface ReplaceWatchlistLayoutPayload {
  symbols: string[];
  sections: Array<{
    title: string;
    index: number;
  }>;
  sortKey?: "manual" | "symbol" | "price" | "change" | "changeAbs" | "volume";
  sortDir?: "asc" | "desc";
}

interface DeleteWatchlistResponse {
  ok: boolean;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export async function listWatchlists(): Promise<BackendWatchlist[]> {
  return getJson<BackendWatchlist[]>("watchlists");
}

export async function createWatchlist(name: string): Promise<BackendWatchlist> {
  return postJson<BackendWatchlist>("watchlists", { name });
}

export async function updateWatchlist(
  id: string,
  payload: UpdateWatchlistPayload,
): Promise<BackendWatchlist> {
  return patchJson<BackendWatchlist>(
    `watchlists/${encodePathSegment(id)}`,
    payload,
  );
}

export async function setActiveWatchlist(id: string): Promise<BackendWatchlist> {
  return putJson<BackendWatchlist>("watchlists/active", { id });
}

export async function replaceWatchlistLayout(
  id: string,
  payload: ReplaceWatchlistLayoutPayload,
): Promise<BackendWatchlist> {
  return putJson<BackendWatchlist>(
    `watchlists/${encodePathSegment(id)}/layout`,
    payload,
  );
}

export async function deleteWatchlist(id: string): Promise<void> {
  await deleteJson<DeleteWatchlistResponse>(`watchlists/${encodePathSegment(id)}`);
}

export async function addWatchlistSymbol(
  id: string,
  symbol: string,
): Promise<BackendWatchlist> {
  return postJson<BackendWatchlist>(
    `watchlists/${encodePathSegment(id)}/symbols`,
    { symbol },
  );
}

export async function removeWatchlistSymbol(
  id: string,
  symbol: string,
): Promise<BackendWatchlist> {
  return deleteJson<BackendWatchlist>(
    `watchlists/${encodePathSegment(id)}/symbols/${encodePathSegment(symbol)}`,
  );
}
