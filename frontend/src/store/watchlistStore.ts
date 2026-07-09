"use client";
import { atom, useAtomValue, type Getter, type Setter } from "jotai";
import { getDefaultStore } from "jotai";
import { backendSessionAtom } from "@/store/authStore";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import {
  createWatchlist as createRemoteWatchlist,
  deleteWatchlist as deleteRemoteWatchlist,
  replaceWatchlistLayout as replaceRemoteWatchlistLayout,
  setActiveWatchlist as setRemoteActiveWatchlist,
  updateWatchlist as updateRemoteWatchlist,
  type BackendWatchlist,
} from "@/services/api/resources/watchlistsApi";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { uid } from "@/utils/id";
import {
  clampSectionIndex,
  createWatchlistSection,
  moveSectionInList,
  moveSymbolInList,
  moveSymbolToSectionInList,
  moveSymbolToUnsectionedStartInList,
  normalizeSectionTitle,
  removeSectionFromList,
  removeSymbolFromList,
  renameSectionInList,
  type SectionInsertMode,
  type WatchlistSectionMoveTarget,
} from "./watchlistLayout";

export type SortKey = "symbol" | "price" | "change" | "changeAbs" | "volume";
export type SortDir = "asc" | "desc";

export interface WatchlistSection {
  id: string;
  title: string;
  /**
   * Symbol insertion index. This keeps sections stable without changing the
   * public `watchlistSymbolsAtom` contract used by market-data subscriptions.
   */
  index: number;
}

export interface WatchlistList {
  id: string;
  name: string;
  symbols: string[];
  sections: WatchlistSection[];
  shared: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
}

type SymbolUpdate = string[] | ((prev: string[]) => string[]);
type AddSectionPayload = string | { title: string; index?: number };
type MoveSymbolPayload = {
  ticker: string;
  index: number;
  mode?: SectionInsertMode;
  targetSectionId?: string;
  unsectionedStart?: boolean;
};
type MoveSectionPayload = {
  sectionId: string;
  target: WatchlistSectionMoveTarget;
};

const DEFAULT_LIST_ID = "default";

const DEFAULT_LIST: WatchlistList = {
  id: DEFAULT_LIST_ID,
  name: "Watchlist",
  symbols: [],
  sections: [],
  shared: false,
  sortKey: "symbol",
  sortDir: "asc",
};

function cleanSortKey(input: unknown, fallback: SortKey = "symbol"): SortKey {
  return input === "symbol" ||
    input === "price" ||
    input === "change" ||
    input === "changeAbs" ||
    input === "volume"
    ? input
    : fallback;
}

function cleanSortDir(input: unknown, fallback: SortDir = "asc"): SortDir {
  return input === "desc" || input === "asc" ? input : fallback;
}

function cleanSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const symbol = value.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

function cleanSections(input: unknown, symbolCount: number): WatchlistSection[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((section): WatchlistSection | null => {
      if (!section || typeof section !== "object") return null;
      const raw = section as Partial<WatchlistSection>;
      const title =
        typeof raw.title === "string" ? normalizeSectionTitle(raw.title) : "Section";
      const index =
        typeof raw.index === "number"
          ? clampSectionIndex(raw.index, symbolCount)
          : symbolCount;
      return {
        id: typeof raw.id === "string" && raw.id ? raw.id : uid("wl_section"),
        title,
        index,
      };
    })
    .filter((section): section is WatchlistSection => !!section)
    .sort((a, b) => a.index - b.index);
}

function normalizeList(input: unknown, fallback = DEFAULT_LIST): WatchlistList {
  if (!input || typeof input !== "object") return fallback;
  const raw = input as Partial<WatchlistList>;
  const symbols = cleanSymbols(raw.symbols);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : uid("wl"),
    name:
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 40)
        : fallback.name,
    symbols,
    sections: cleanSections(raw.sections, symbols.length),
    shared: raw.shared === true,
    sortKey: cleanSortKey(raw.sortKey, fallback.sortKey),
    sortDir: cleanSortDir(raw.sortDir, fallback.sortDir),
  };
}

function activeList(lists: WatchlistList[], activeId: string): WatchlistList {
  return lists.find((list) => list.id === activeId) ?? lists[0] ?? DEFAULT_LIST;
}

function persist(lists: WatchlistList[], activeId: string): void {
  void lists;
  void activeId;
  // Watchlists are backend-owned. Jotai keeps only an in-memory optimistic cache
  // so browser localStorage cannot become a stale second source of truth.
}

function updateActive(
  lists: WatchlistList[],
  activeId: string,
  updater: (list: WatchlistList) => WatchlistList,
): WatchlistList[] {
  const current = activeList(lists, activeId);
  return lists.map((list) => (list.id === current.id ? updater(list) : list));
}

export const watchlistListsAtom = atom<WatchlistList[]>([DEFAULT_LIST]);
export const activeWatchlistIdAtom = atom<string>(DEFAULT_LIST_ID);
export const watchlistSortKeyAtom = atom<SortKey>("symbol");
export const watchlistSortDirAtom = atom<SortDir>("asc");

export const activeWatchlistAtom = atom((get) =>
  activeList(get(watchlistListsAtom), get(activeWatchlistIdAtom)),
);

export const watchlistSymbolsAtom = atom(
  (get) => get(activeWatchlistAtom).symbols,
  (get, set, update: SymbolUpdate) => {
    const activeId = get(activeWatchlistIdAtom);
    const current = get(activeWatchlistAtom);
    const nextSymbols = cleanSymbols(
      typeof update === "function" ? update(current.symbols) : update,
    );
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
      ...list,
      symbols: nextSymbols,
      sections: list.sections.filter((section) => section.index <= nextSymbols.length),
    }));
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
    const nextList = activeList(lists, activeId);

    runRemoteSync(get, set, "set symbols", async () => {
      await replaceRemoteLayoutFromLocal(nextList);
    });
  },
);

export const replaceWatchlistSymbolsFromCatalogAtom = atom(
  null,
  () => {
    // Deprecated: watchlist symbols are server-owned. MT5 catalog refreshes must
    // not overwrite user watchlists.
  },
);

export const watchlistSectionsAtom = atom(
  (get) => get(activeWatchlistAtom).sections,
);

export const setActiveWatchlistAtom = atom(null, (get, set, listId: string) => {
  const lists = get(watchlistListsAtom);
  const nextActive = lists.some((list) => list.id === listId)
    ? listId
    : activeList(lists, get(activeWatchlistIdAtom)).id;
  set(activeWatchlistIdAtom, nextActive);
  const nextList = activeList(lists, nextActive);
  set(watchlistSortKeyAtom, nextList.sortKey);
  set(watchlistSortDirAtom, nextList.sortDir);
  persist(lists, nextActive);

  runRemoteSync(get, set, "set active list", async () => {
    if (!isServerWatchlistId(nextActive)) return;
    await setRemoteActiveWatchlist(nextActive);
  });
});

export const hydrateWatchlistAtom = atom(null, (_get, set) => {
  set(watchlistListsAtom, [DEFAULT_LIST]);
  set(activeWatchlistIdAtom, DEFAULT_LIST_ID);
  set(watchlistSortKeyAtom, DEFAULT_LIST.sortKey);
  set(watchlistSortDirAtom, DEFAULT_LIST.sortDir);
});

type RemoteWatchlist = BackendWatchlist;

function remoteWatchlistToLocal(input: RemoteWatchlist): WatchlistList {
  const fallback: WatchlistList = {
    ...DEFAULT_LIST,
    id: input.id || uid("wl"),
    name: input.name || DEFAULT_LIST.name,
  };
  return normalizeList(
    {
      id: input.id,
      name: input.name,
      symbols: input.symbols ?? [],
      sections: input.sections ?? [],
      shared: input.shared === true,
      sortKey: input.sortKey,
      sortDir: input.sortDir,
    },
    fallback,
  );
}

const EMPTY_REMOTE_LIST: WatchlistList = {
  ...DEFAULT_LIST,
  symbols: [],
  sections: [],
};

function isRemoteSyncEnabled(get: Getter): boolean {
  return get(backendSessionAtom);
}

function isServerWatchlistId(id: string): boolean {
  return id !== DEFAULT_LIST_ID && !id.startsWith("wl");
}

function logRemoteSyncError(action: string, error: unknown): void {
  reportFrontendError(error, {
    title: "Watchlist sync failed",
    logPrefix: `Watchlist sync failed (${action})`,
  });
}

function runRemoteSync(
  get: Getter,
  _set: Setter,
  action: string,
  work: () => Promise<unknown>,
): void {
  if (!isRemoteSyncEnabled(get)) return;
  void work().catch((error) => logRemoteSyncError(action, error));
}

function remoteLayoutPayload(list: WatchlistList) {
  return {
    symbols: list.symbols,
    sections: list.sections.map((section) => ({
      title: section.title,
      index: section.index,
    })),
  };
}

async function replaceRemoteLayoutFromLocal(list: WatchlistList): Promise<void> {
  if (!isServerWatchlistId(list.id)) return;
  await replaceRemoteWatchlistLayout(list.id, remoteLayoutPayload(list));
}

async function replaceLocalListWithRemote(
  get: Getter,
  set: Setter,
  localId: string,
  remote: RemoteWatchlist,
): Promise<WatchlistList | null> {
  const lists = get(watchlistListsAtom);
  const activeId = get(activeWatchlistIdAtom);
  const local = lists.find((list) => list.id === localId);
  if (!local) return null;

  const nextList: WatchlistList = {
    ...local,
    id: remote.id,
    name: remote.name || local.name,
    sortKey: cleanSortKey(remote.sortKey, local.sortKey),
    sortDir: cleanSortDir(remote.sortDir, local.sortDir),
  };
  const nextLists = lists.map((list) => (list.id === localId ? nextList : list));
  const nextActiveId = activeId === localId ? nextList.id : activeId;
  set(watchlistListsAtom, nextLists);
  set(activeWatchlistIdAtom, nextActiveId);
  if (nextActiveId === nextList.id) {
    set(watchlistSortKeyAtom, nextList.sortKey);
    set(watchlistSortDirAtom, nextList.sortDir);
  }
  persist(nextLists, nextActiveId);
  return nextList;
}

async function createRemoteListFromLocal(
  get: Getter,
  set: Setter,
  localId: string,
  name: string,
): Promise<void> {
  const remote = await createRemoteWatchlist(name);
  const synced = await replaceLocalListWithRemote(get, set, localId, remote);
  if (!synced) return;
  await replaceRemoteLayoutFromLocal(synced);
  if (synced.sortKey !== "symbol" || synced.sortDir !== "asc") {
    await updateRemoteWatchlist(synced.id, {
      sortKey: synced.sortKey,
      sortDir: synced.sortDir,
    });
  }
  if (get(activeWatchlistIdAtom) === synced.id) {
    await setRemoteActiveWatchlist(synced.id);
  }
}

export const applyRemoteWatchlistsAtom = atom(
  null,
  (get, set, payload: unknown) => {
    if (!Array.isArray(payload)) return;

    const remoteLists = payload
      .filter((item): item is RemoteWatchlist => {
        return (
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as RemoteWatchlist).id === "string" &&
          typeof (item as RemoteWatchlist).name === "string"
        );
      })
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((item) => remoteWatchlistToLocal(item));

    const lists = remoteLists.length
      ? remoteLists
      : [EMPTY_REMOTE_LIST];

    const previousActiveId = get(activeWatchlistIdAtom);
    const remoteActive = payload.find(
      (item): item is RemoteWatchlist =>
        Boolean(item) &&
        typeof item === "object" &&
        (item as RemoteWatchlist).active === true &&
        typeof (item as RemoteWatchlist).id === "string",
    );
    const activeId = remoteActive?.id
      ? remoteActive.id
      : lists.some((list) => list.id === previousActiveId)
      ? previousActiveId
      : lists[0].id;
    set(watchlistListsAtom, lists);
    set(activeWatchlistIdAtom, activeId);
    const nextActiveList = activeList(lists, activeId);
    set(watchlistSortKeyAtom, nextActiveList.sortKey);
    set(watchlistSortDirAtom, nextActiveList.sortDir);
    persist(lists, activeId);
  },
);

export const addWatchlistSymbolAtom = atom(null, (get, set, ticker: string) => {
  const symbol = ticker.trim().toUpperCase();
  if (!getMarketSymbol(symbol)) return;
  const symbols = get(watchlistSymbolsAtom);
  if (symbols.includes(symbol)) return;
  const activeId = get(activeWatchlistIdAtom);
  const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
    ...list,
    symbols: [...list.symbols, symbol],
  }));
  set(watchlistListsAtom, lists);
  persist(lists, activeId);
  const nextList = activeList(lists, activeId);

  runRemoteSync(get, set, "add symbol", async () => {
    await replaceRemoteLayoutFromLocal(nextList);
  });
});

export const removeWatchlistSymbolAtom = atom(
  null,
  (get, set, ticker: string) => {
    const symbol = ticker.trim().toUpperCase();
    const current = get(activeWatchlistAtom);
    if (!current.symbols.includes(symbol)) return;
    const activeId = get(activeWatchlistIdAtom);
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) =>
      removeSymbolFromList(list, symbol),
    );
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
    const nextList = activeList(lists, activeId);

    runRemoteSync(get, set, "remove symbol", async () => {
      await replaceRemoteLayoutFromLocal(nextList);
    });
  },
);

export const renameWatchlistAtom = atom(null, (get, set, name: string) => {
  const nextName = name.trim().slice(0, 40);
  if (!nextName) return;
  const current = get(activeWatchlistAtom);
  const activeId = get(activeWatchlistIdAtom);
  const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
    ...list,
    name: nextName,
  }));
  set(watchlistListsAtom, lists);
  persist(lists, activeId);

  runRemoteSync(get, set, "rename list", async () => {
    if (!isServerWatchlistId(current.id)) return;
    await updateRemoteWatchlist(current.id, { name: nextName });
  });
});

export const setWatchlistSharedAtom = atom(
  null,
  (get, set, shared?: boolean) => {
    const activeId = get(activeWatchlistIdAtom);
    const current = get(activeWatchlistAtom);
    const nextShared = shared ?? !current.shared;
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
      ...list,
      shared: nextShared,
    }));
    set(watchlistListsAtom, lists);
    persist(lists, activeId);

    runRemoteSync(get, set, "set shared", async () => {
      if (!isServerWatchlistId(current.id)) return;
      await updateRemoteWatchlist(current.id, { shared: nextShared });
    });
  },
);

export const copyWatchlistAtom = atom(null, (get, set) => {
  const current = get(activeWatchlistAtom);
  const copy: WatchlistList = {
    ...current,
    id: uid("wl"),
    name: `${current.name} copy`.slice(0, 40),
    shared: false,
    sortKey: current.sortKey,
    sortDir: current.sortDir,
    sections: current.sections.map((section) => ({
      ...section,
      id: uid("wl_section"),
    })),
  };
  const lists = [...get(watchlistListsAtom), copy];
  set(watchlistListsAtom, lists);
  set(activeWatchlistIdAtom, copy.id);
  set(watchlistSortKeyAtom, copy.sortKey);
  set(watchlistSortDirAtom, copy.sortDir);
  persist(lists, copy.id);

  runRemoteSync(get, set, "copy list", async () => {
    await createRemoteListFromLocal(get, set, copy.id, copy.name);
  });
});

export const createWatchlistAtom = atom(null, (get, set, name?: string) => {
  const list: WatchlistList = {
    id: uid("wl"),
    name: (name?.trim() || "Untitled list").slice(0, 40),
    symbols: [],
    sections: [],
    shared: false,
    sortKey: "symbol",
    sortDir: "asc",
  };
  const lists = [...get(watchlistListsAtom), list];
  set(watchlistListsAtom, lists);
  set(activeWatchlistIdAtom, list.id);
  set(watchlistSortKeyAtom, list.sortKey);
  set(watchlistSortDirAtom, list.sortDir);
  persist(lists, list.id);

  runRemoteSync(get, set, "create list", async () => {
    await createRemoteListFromLocal(get, set, list.id, list.name);
  });
});

export const removeWatchlistAtom = atom(null, (get, set, listId: string) => {
  const lists = get(watchlistListsAtom);
  if (lists.length <= 1) return;
  const target = lists.find((list) => list.id === listId);
  if (!target) return;

  const targetIndex = lists.findIndex((list) => list.id === listId);
  const nextLists = lists.filter((list) => list.id !== listId);
  const currentActiveId = get(activeWatchlistIdAtom);
  const fallbackIndex = Math.min(targetIndex, nextLists.length - 1);
  const nextActiveId =
    currentActiveId === listId
      ? nextLists[Math.max(0, fallbackIndex)].id
      : currentActiveId;

  set(watchlistListsAtom, nextLists);
  set(activeWatchlistIdAtom, nextActiveId);
  const nextActiveList = activeList(nextLists, nextActiveId);
  set(watchlistSortKeyAtom, nextActiveList.sortKey);
  set(watchlistSortDirAtom, nextActiveList.sortDir);
  persist(nextLists, nextActiveId);

  runRemoteSync(get, set, "delete list", async () => {
    if (!isServerWatchlistId(target.id)) return;
    await deleteRemoteWatchlist(target.id);
    if (isServerWatchlistId(nextActiveId)) {
      await setRemoteActiveWatchlist(nextActiveId);
    }
  });
});

export const clearWatchlistAtom = atom(null, (get, set) => {
  const activeId = get(activeWatchlistIdAtom);
  const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
    ...list,
    symbols: [],
    sections: [],
  }));
  set(watchlistListsAtom, lists);
  persist(lists, activeId);
  const nextList = activeList(lists, activeId);

  runRemoteSync(get, set, "clear list", async () => {
    await replaceRemoteLayoutFromLocal(nextList);
  });
});

export const addWatchlistSectionAtom = atom(
  null,
  (get, set, payload: AddSectionPayload) => {
    const title = typeof payload === "string" ? payload : payload.title;
    const label = normalizeSectionTitle(title);
    if (!label) return;
    const activeId = get(activeWatchlistIdAtom);
    const current = get(activeWatchlistAtom);
    const requestedIndex =
      typeof payload === "string" ? undefined : payload.index;
    const index =
      typeof requestedIndex === "number" && Number.isFinite(requestedIndex)
        ? clampSectionIndex(requestedIndex, current.symbols.length)
        : current.symbols.length;
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
      ...list,
      sections: [
        ...list.sections,
        createWatchlistSection(label, index, list.symbols.length),
      ],
    }));
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
    const nextList = activeList(lists, activeId);

    runRemoteSync(get, set, "add section", async () => {
      await replaceRemoteLayoutFromLocal(nextList);
    });
  },
);

export const renameWatchlistSectionAtom = atom(
  null,
  (get, set, sectionId: string, title: string) => {
    const activeId = get(activeWatchlistIdAtom);
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) =>
      renameSectionInList(list, sectionId, title),
    );
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
    const nextList = activeList(lists, activeId);

    runRemoteSync(get, set, "rename section", async () => {
      await replaceRemoteLayoutFromLocal(nextList);
    });
  },
);

export const removeWatchlistSectionAtom = atom(
  null,
  (get, set, sectionId: string) => {
    const activeId = get(activeWatchlistIdAtom);
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) =>
      removeSectionFromList(list, sectionId),
    );
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
    const nextList = activeList(lists, activeId);

    runRemoteSync(get, set, "remove section", async () => {
      await replaceRemoteLayoutFromLocal(nextList);
    });
  },
);

export const moveWatchlistSymbolAtom = atom(
  null,
  (get, set, payload: MoveSymbolPayload) => {
    const activeId = get(activeWatchlistIdAtom);
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) =>
      payload.unsectionedStart
        ? moveSymbolToUnsectionedStartInList(list, payload.ticker)
        : payload.targetSectionId
        ? moveSymbolToSectionInList(
            list,
            payload.ticker,
            payload.targetSectionId,
            payload.mode,
          )
        : moveSymbolInList(list, payload.ticker, payload.index, payload.mode),
    );
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
    const nextList = activeList(lists, activeId);

    runRemoteSync(get, set, "move symbol", async () => {
      await replaceRemoteLayoutFromLocal(nextList);
    });
  },
);

export const moveWatchlistSectionAtom = atom(
  null,
  (get, set, payload: MoveSectionPayload) => {
    const activeId = get(activeWatchlistIdAtom);
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) =>
      moveSectionInList(list, payload.sectionId, payload.target),
    );
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
    const nextList = activeList(lists, activeId);

    runRemoteSync(get, set, "move section", async () => {
      await replaceRemoteLayoutFromLocal(nextList);
    });
  },
);

export const setWatchlistSortAtom = atom(null, (get, set, key: SortKey) => {
  const curKey = get(watchlistSortKeyAtom);
  const curDir = get(watchlistSortDirAtom);
  const nextDir: SortDir = curKey === key && curDir === "asc" ? "desc" : "asc";
  const activeId = get(activeWatchlistIdAtom);
  const current = get(activeWatchlistAtom);
  set(watchlistSortKeyAtom, key);
  set(watchlistSortDirAtom, nextDir);
  const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
    ...list,
    sortKey: key,
    sortDir: nextDir,
  }));
  set(watchlistListsAtom, lists);
  persist(lists, activeId);

  runRemoteSync(get, set, "set sort", async () => {
    if (!isServerWatchlistId(current.id)) return;
    await updateRemoteWatchlist(current.id, { sortKey: key, sortDir: nextDir });
  });
});

interface WatchlistState {
  lists: WatchlistList[];
  activeList: WatchlistList;
  symbols: string[];
  sections: WatchlistSection[];
  sortKey: SortKey;
  sortDir: SortDir;
}

export interface WatchlistActions {
  add: (ticker: string) => void;
  remove: (ticker: string) => void;
  rename: (name: string) => void;
  setShared: (shared?: boolean) => void;
  copy: () => void;
  create: (name?: string) => void;
  setActive: (listId: string) => void;
  removeList: (listId: string) => void;
  clear: () => void;
  addSection: (title: string, index?: number) => void;
  renameSection: (sectionId: string, title: string) => void;
  removeSection: (sectionId: string) => void;
  moveSection: (sectionId: string, target: WatchlistSectionMoveTarget) => void;
  moveSymbol: (
    ticker: string,
    index: number,
    mode?: SectionInsertMode,
    targetSectionId?: string,
    unsectionedStart?: boolean,
  ) => void;
  setSort: (key: SortKey) => void;
  hydrate: () => void;
}

type WatchlistStoreInterface = WatchlistState & WatchlistActions;

const watchlistStateAtom = atom<WatchlistState>((get) => ({
  lists: get(watchlistListsAtom),
  activeList: get(activeWatchlistAtom),
  symbols: get(watchlistSymbolsAtom),
  sections: get(watchlistSectionsAtom),
  sortKey: get(watchlistSortKeyAtom),
  sortDir: get(watchlistSortDirAtom),
}));

const watchlistCombinedAtom = atom<WatchlistStoreInterface>((get) => {
  const state = get(watchlistStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    add: (ticker) => store.set(addWatchlistSymbolAtom, ticker),
    remove: (ticker) => store.set(removeWatchlistSymbolAtom, ticker),
    rename: (name) => store.set(renameWatchlistAtom, name),
    setShared: (shared) => store.set(setWatchlistSharedAtom, shared),
    copy: () => store.set(copyWatchlistAtom),
    create: (name) => store.set(createWatchlistAtom, name),
    setActive: (listId) => store.set(setActiveWatchlistAtom, listId),
    removeList: (listId) => store.set(removeWatchlistAtom, listId),
    clear: () => store.set(clearWatchlistAtom),
    addSection: (title, index) =>
      store.set(addWatchlistSectionAtom, { title, index }),
    renameSection: (sectionId, title) =>
      store.set(renameWatchlistSectionAtom, sectionId, title),
    removeSection: (sectionId) => store.set(removeWatchlistSectionAtom, sectionId),
    moveSection: (sectionId, target) =>
      store.set(moveWatchlistSectionAtom, { sectionId, target }),
    moveSymbol: (ticker, index, mode, targetSectionId, unsectionedStart) =>
      store.set(moveWatchlistSymbolAtom, {
        ticker,
        index,
        mode,
        targetSectionId,
        unsectionedStart,
      }),
    setSort: (key) => store.set(setWatchlistSortAtom, key),
    hydrate: () => store.set(hydrateWatchlistAtom),
  };
});

export function useWatchlistStore(): WatchlistStoreInterface;
export function useWatchlistStore<T>(
  selector: (state: WatchlistStoreInterface) => T,
): T;
export function useWatchlistStore<T>(
  selector?: (state: WatchlistStoreInterface) => T,
): WatchlistStoreInterface | T {
  const combined = useAtomValue(watchlistCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

export function getWatchlistState(): WatchlistStoreInterface {
  return getDefaultStore().get(watchlistCombinedAtom);
}
