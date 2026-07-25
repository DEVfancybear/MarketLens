import type { ReplaceWatchlistLayoutPayload } from "@/services/api/resources/watchlistsApi";
import type { WatchlistList } from "./watchlistStore";

/** Exact full-layout contract sent to the backend source of truth. */
export function createRemoteWatchlistLayoutPayload(
  list: WatchlistList,
): ReplaceWatchlistLayoutPayload {
  return {
    symbols: [...list.symbols],
    sections: list.sections.map((section) => ({
      title: section.title,
      index: section.index,
    })),
    sortKey: list.sortKey,
    sortDir: list.sortDir,
  };
}
