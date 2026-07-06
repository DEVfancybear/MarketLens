import { getJson } from "@/services/api/client";

export interface BackendWatchlist {
  id: string;
  name: string;
  position: number;
  symbols: string[];
}

export async function listWatchlists(): Promise<BackendWatchlist[]> {
  return getJson<BackendWatchlist[]>("watchlists");
}
