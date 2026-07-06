"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { localStore } from "@/services/storage";
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

const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "XAUUSD",
  "SPX500",
];

const DEFAULT_LIST_ID = "default";
const STORAGE_LISTS = "watchlist:lists";
const STORAGE_ACTIVE = "watchlist:activeId";
const STORAGE_LEGACY_SYMBOLS = "watchlist";

const DEFAULT_LIST: WatchlistList = {
  id: DEFAULT_LIST_ID,
  name: "Watchlist",
  symbols: DEFAULT_SYMBOLS,
  sections: [],
  shared: false,
};

function cleanSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) return DEFAULT_SYMBOLS;
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const symbol = value.trim().toUpperCase();
    if (!symbol || seen.has(symbol) || !getMarketSymbol(symbol)) continue;
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
  };
}

function activeList(lists: WatchlistList[], activeId: string): WatchlistList {
  return lists.find((list) => list.id === activeId) ?? lists[0] ?? DEFAULT_LIST;
}

function persist(lists: WatchlistList[], activeId: string): void {
  const active = activeList(lists, activeId);
  localStore.set(STORAGE_LISTS, lists);
  localStore.set(STORAGE_ACTIVE, active.id);
  // Keep the old key in sync so older code/users can migrate without data loss.
  localStore.set(STORAGE_LEGACY_SYMBOLS, active.symbols);
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
export const watchlistSortDirAtom = atom<"asc" | "desc">("asc");

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
  },
);

export const watchlistSectionsAtom = atom(
  (get) => get(activeWatchlistAtom).sections,
);

export const hydrateWatchlistAtom = atom(null, (_get, set) => {
  const storedLists = localStore.get<unknown>(STORAGE_LISTS, null);
  const legacySymbols = localStore.get<string[]>(STORAGE_LEGACY_SYMBOLS, DEFAULT_SYMBOLS);

  const lists =
    Array.isArray(storedLists) && storedLists.length
      ? storedLists.map((list) => normalizeList(list)).filter(Boolean)
      : [
          {
            ...DEFAULT_LIST,
            symbols: cleanSymbols(legacySymbols),
          },
        ];

  const normalized = lists.length ? lists : [DEFAULT_LIST];
  const storedActive = localStore.get<string>(STORAGE_ACTIVE, normalized[0].id);
  const activeId = normalized.some((list) => list.id === storedActive)
    ? storedActive
    : normalized[0].id;

  set(watchlistListsAtom, normalized);
  set(activeWatchlistIdAtom, activeId);
  persist(normalized, activeId);
});

interface RemoteWatchlist {
  id: string;
  name: string;
  position?: number;
  symbols?: string[];
}

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
      sections: [],
      shared: false,
    },
    fallback,
  );
}

const EMPTY_REMOTE_LIST: WatchlistList = {
  ...DEFAULT_LIST,
  symbols: [],
  sections: [],
};

export const applyRemoteWatchlistsAtom = atom(
  null,
  (_get, set, payload: unknown) => {
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
      .map(remoteWatchlistToLocal);

    const lists = remoteLists.length ? remoteLists : [EMPTY_REMOTE_LIST];
    const activeId = lists[0].id;
    set(watchlistListsAtom, lists);
    set(activeWatchlistIdAtom, activeId);
    persist(lists, activeId);
  },
);

export const addWatchlistSymbolAtom = atom(null, (get, set, ticker: string) => {
  const symbol = ticker.trim().toUpperCase();
  if (!getMarketSymbol(symbol)) return;
  const symbols = get(watchlistSymbolsAtom);
  if (symbols.includes(symbol)) return;
  set(watchlistSymbolsAtom, [...symbols, symbol]);
});

export const removeWatchlistSymbolAtom = atom(
  null,
  (get, set, ticker: string) => {
    const activeId = get(activeWatchlistIdAtom);
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) =>
      removeSymbolFromList(list, ticker),
    );
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
  },
);

export const renameWatchlistAtom = atom(null, (get, set, name: string) => {
  const nextName = name.trim().slice(0, 40);
  if (!nextName) return;
  const activeId = get(activeWatchlistIdAtom);
  const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
    ...list,
    name: nextName,
  }));
  set(watchlistListsAtom, lists);
  persist(lists, activeId);
});

export const setWatchlistSharedAtom = atom(
  null,
  (get, set, shared?: boolean) => {
    const activeId = get(activeWatchlistIdAtom);
    const lists = updateActive(get(watchlistListsAtom), activeId, (list) => ({
      ...list,
      shared: shared ?? !list.shared,
    }));
    set(watchlistListsAtom, lists);
    persist(lists, activeId);
  },
);

export const copyWatchlistAtom = atom(null, (get, set) => {
  const current = get(activeWatchlistAtom);
  const copy: WatchlistList = {
    ...current,
    id: uid("wl"),
    name: `${current.name} copy`.slice(0, 40),
    shared: false,
    sections: current.sections.map((section) => ({
      ...section,
      id: uid("wl_section"),
    })),
  };
  const lists = [...get(watchlistListsAtom), copy];
  set(watchlistListsAtom, lists);
  set(activeWatchlistIdAtom, copy.id);
  persist(lists, copy.id);
});

export const createWatchlistAtom = atom(null, (get, set, name?: string) => {
  const list: WatchlistList = {
    id: uid("wl"),
    name: (name?.trim() || "Untitled list").slice(0, 40),
    symbols: [],
    sections: [],
    shared: false,
  };
  const lists = [...get(watchlistListsAtom), list];
  set(watchlistListsAtom, lists);
  set(activeWatchlistIdAtom, list.id);
  persist(lists, list.id);
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
  },
);

export const setWatchlistSortAtom = atom(null, (get, set, key: SortKey) => {
  const curKey = get(watchlistSortKeyAtom);
  const curDir = get(watchlistSortDirAtom);
  set(watchlistSortKeyAtom, key);
  set(
    watchlistSortDirAtom,
    curKey === key && curDir === "asc" ? "desc" : "asc",
  );
});

interface WatchlistState {
  lists: WatchlistList[];
  activeList: WatchlistList;
  symbols: string[];
  sections: WatchlistSection[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}

export interface WatchlistActions {
  add: (ticker: string) => void;
  remove: (ticker: string) => void;
  rename: (name: string) => void;
  setShared: (shared?: boolean) => void;
  copy: () => void;
  create: (name?: string) => void;
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
