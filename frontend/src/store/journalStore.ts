"use client";
import { atom, getDefaultStore, useAtomValue } from "jotai";
import type { JournalEntry, ScreenshotRef } from "@/types";
import { journalDB, screenshotDB } from "@/services/storage";
import {
  createJournalEntry,
  deleteJournalEntry,
  listJournal,
  updateJournalEntry,
  uploadJournalScreenshot,
} from "@/services/api/resources/journalApi";
import { authUserAtom, backendSessionAtom } from "@/store/authStore";

export const journalEntriesAtom = atom<JournalEntry[]>([]);
export const journalLoadedAtom = atom(false);
export const journalLoadingAtom = atom(false);
export const journalErrorAtom = atom<string | null>(null);
const journalSourceAtom = atom<string | null>(null);

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Journal sync failed";
}

async function replaceLocalCache(entries: JournalEntry[]): Promise<void> {
  await journalDB.clear();
  await Promise.all(entries.map((entry) => journalDB.put(entry)));
}

async function uploadLocalScreenshots(entry: JournalEntry): Promise<void> {
  for (const ref of entry.screenshots ?? []) {
    const blob = await screenshotDB.get(ref.id);
    if (!blob) continue;
    await uploadJournalScreenshot(entry.id, ref.phase, blob);
  }
}

export const loadJournalAtom = atom(null, async (get, set) => {
  const user = get(authUserAtom);
  const source = get(backendSessionAtom) && user ? `backend:${user.uid}` : "local";
  if (get(journalLoadedAtom) && get(journalSourceAtom) === source) return;
  if (get(journalLoadingAtom)) return;
  set(journalLoadingAtom, true);
  set(journalErrorAtom, null);
  set(journalSourceAtom, source);
  try {
    const localEntries = await journalDB.all();
    if (!get(backendSessionAtom)) {
      set(journalEntriesAtom, localEntries);
      set(journalLoadedAtom, true);
      return;
    }

    // clientId makes entry creation idempotent. Existing IndexedDB rows are an
    // offline buffer, so flush them before pulling the authoritative snapshot.
    for (const entry of localEntries) {
      await createJournalEntry(entry);
      await uploadLocalScreenshots(entry);
    }
    const remoteEntries = await listJournal({ limit: 100 });
    set(journalEntriesAtom, remoteEntries);
    set(journalLoadedAtom, true);
    await replaceLocalCache(remoteEntries);
  } catch (error) {
    const fallback = await journalDB.all();
    set(journalEntriesAtom, fallback);
    set(journalLoadedAtom, true);
    set(journalErrorAtom, message(error));
  } finally {
    set(journalLoadingAtom, false);
  }
});

export const addJournalEntryAtom = atom(
  null,
  async (get, set, entry: JournalEntry) => {
    set(journalEntriesAtom, [entry, ...get(journalEntriesAtom)]);
    await journalDB.put(entry);
    if (!get(backendSessionAtom)) return;
    try {
      await createJournalEntry(entry);
      set(journalErrorAtom, null);
    } catch (error) {
      set(journalErrorAtom, message(error));
    }
  },
);

export const updateJournalEntryAtom = atom(
  null,
  async (get, set, id: string, patch: Partial<JournalEntry>) => {
    const entries = get(journalEntriesAtom).map((entry) =>
      entry.id === id ? { ...entry, ...patch } : entry,
    );
    set(journalEntriesAtom, entries);
    const updated = entries.find((entry) => entry.id === id);
    if (!updated) return;
    await journalDB.put(updated);
    if (!get(backendSessionAtom)) return;
    try {
      await updateJournalEntry(updated);
      set(journalErrorAtom, null);
    } catch (error) {
      set(journalErrorAtom, message(error));
    }
  },
);

export const removeJournalEntryAtom = atom(
  null,
  async (get, set, id: string) => {
    const entry = get(journalEntriesAtom).find((item) => item.id === id);
    if (!entry) return;
    set(
      journalEntriesAtom,
      get(journalEntriesAtom).filter((item) => item.id !== id),
    );
    if (get(backendSessionAtom)) {
      try {
        await deleteJournalEntry(id);
        set(journalErrorAtom, null);
      } catch (error) {
        set(journalEntriesAtom, [entry, ...get(journalEntriesAtom)]);
        set(journalErrorAtom, message(error));
        return;
      }
    }
    await Promise.all(
      (entry.screenshots ?? []).map((shot) => screenshotDB.remove(shot.id)),
    );
    await journalDB.remove(id);
  },
);

export const attachScreenshotAtom = atom(
  null,
  async (
    get,
    set,
    id: string,
    ref: ScreenshotRef,
    blob: Blob,
  ) => {
    await screenshotDB.put(ref.id, blob);
    const entry = get(journalEntriesAtom).find((item) => item.id === id);
    if (!entry) return;
    const optimistic = { ...entry, screenshots: [...(entry.screenshots ?? []), ref] };
    set(
      journalEntriesAtom,
      get(journalEntriesAtom).map((item) => (item.id === id ? optimistic : item)),
    );
    await journalDB.put(optimistic);
    if (!get(backendSessionAtom)) return;
    try {
      const uploaded = await uploadJournalScreenshot(id, ref.phase, blob);
      const synced = {
        ...optimistic,
        screenshots: optimistic.screenshots.map((shot) =>
          shot.id === ref.id ? uploaded : shot,
        ),
      };
      set(
        journalEntriesAtom,
        get(journalEntriesAtom).map((item) => (item.id === id ? synced : item)),
      );
      await journalDB.put(synced);
      await screenshotDB.remove(ref.id);
      set(journalErrorAtom, null);
    } catch (error) {
      set(journalErrorAtom, message(error));
    }
  },
);

export const clearJournalAtom = atom(null, async (get, set) => {
  const entries = get(journalEntriesAtom);
  if (get(backendSessionAtom)) {
    await Promise.all(entries.map((entry) => deleteJournalEntry(entry.id)));
  }
  set(journalEntriesAtom, []);
  await journalDB.clear();
});

interface JournalState {
  entries: JournalEntry[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

export interface JournalActions {
  load: () => Promise<void>;
  add: (entry: JournalEntry) => Promise<void>;
  update: (id: string, patch: Partial<JournalEntry>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  attachScreenshot: (
    id: string,
    ref: ScreenshotRef,
    blob: Blob,
  ) => Promise<void>;
  clear: () => Promise<void>;
}

type JournalStoreInterface = JournalState & JournalActions;

const journalStateAtom = atom<JournalState>((get) => ({
  entries: get(journalEntriesAtom),
  loaded: get(journalLoadedAtom),
  loading: get(journalLoadingAtom),
  error: get(journalErrorAtom),
}));

const journalCombinedAtom = atom<JournalStoreInterface>((get) => {
  const state = get(journalStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    load: async () => { await store.set(loadJournalAtom); },
    add: async (entry) => { await store.set(addJournalEntryAtom, entry); },
    update: async (id, patch) => { await store.set(updateJournalEntryAtom, id, patch); },
    remove: async (id) => { await store.set(removeJournalEntryAtom, id); },
    attachScreenshot: async (id, ref, blob) => {
      await store.set(attachScreenshotAtom, id, ref, blob);
    },
    clear: async () => { await store.set(clearJournalAtom); },
  };
});

export function useJournalStore(): JournalStoreInterface;
export function useJournalStore<T>(selector: (state: JournalStoreInterface) => T): T;
export function useJournalStore<T>(
  selector?: (state: JournalStoreInterface) => T,
): JournalStoreInterface | T {
  const combined = useAtomValue(journalCombinedAtom);
  return selector ? selector(combined) : combined;
}

export function getJournalState(): JournalStoreInterface {
  return getDefaultStore().get(journalCombinedAtom);
}
