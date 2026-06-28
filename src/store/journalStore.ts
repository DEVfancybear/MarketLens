"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import type { JournalEntry, ScreenshotRef } from "@/types";
import { journalDB, screenshotDB } from "@/services/storage";

// ── State atoms ────────────────────────────────────────────────────────────
export const journalEntriesAtom = atom<JournalEntry[]>([]);
export const journalLoadedAtom = atom(false);

// ── Write atoms (actions) ──────────────────────────────────────────────────
export const loadJournalAtom = atom(null, async (get, set) => {
  if (get(journalLoadedAtom)) return;
  const entries = await journalDB.all();
  set(journalEntriesAtom, entries);
  set(journalLoadedAtom, true);
});

export const addJournalEntryAtom = atom(
  null,
  async (get, set, entry: JournalEntry) => {
    set(journalEntriesAtom, [entry, ...get(journalEntriesAtom)]);
    await journalDB.put(entry);
  },
);

export const updateJournalEntryAtom = atom(
  null,
  async (get, set, id: string, patch: Partial<JournalEntry>) => {
    const entries = get(journalEntriesAtom).map((e) =>
      e.id === id ? { ...e, ...patch } : e,
    );
    set(journalEntriesAtom, entries);
    const updated = entries.find((e) => e.id === id);
    if (updated) await journalDB.put(updated);
  },
);

export const removeJournalEntryAtom = atom(
  null,
  async (get, set, id: string) => {
    const entry = get(journalEntriesAtom).find((e) => e.id === id);
    entry?.screenshots?.forEach((s) => screenshotDB.remove(s.id));
    set(
      journalEntriesAtom,
      get(journalEntriesAtom).filter((e) => e.id !== id),
    );
    await journalDB.remove(id);
  },
);

export const attachScreenshotAtom = atom(
  null,
  async (get, _set, id: string, ref: ScreenshotRef, blob: Blob) => {
    await screenshotDB.put(ref.id, blob);
    const entry = get(journalEntriesAtom).find((e) => e.id === id);
    if (!entry) return;
    const screenshots = [...(entry.screenshots ?? []), ref];
    // Re-use update flow to persist.
    const store = getDefaultStore();
    await store.set(updateJournalEntryAtom, id, { screenshots });
  },
);

export const clearJournalAtom = atom(null, async (_get, set) => {
  set(journalEntriesAtom, []);
  await journalDB.clear();
});

// ── Combined state + actions (for compatibility hook) ──────────────────────
interface JournalState {
  entries: JournalEntry[];
  loaded: boolean;
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
}));

const journalCombinedAtom = atom<JournalStoreInterface>((get) => {
  const state = get(journalStateAtom);
  const store = getDefaultStore();
  return {
    ...state,
    load: async () => {
      await store.set(loadJournalAtom);
    },
    add: async (entry) => {
      await store.set(addJournalEntryAtom, entry);
    },
    update: async (id, patch) => {
      await store.set(updateJournalEntryAtom, id, patch);
    },
    remove: async (id) => {
      await store.set(removeJournalEntryAtom, id);
    },
    attachScreenshot: async (id, ref, blob) => {
      await store.set(attachScreenshotAtom, id, ref, blob);
    },
    clear: async () => {
      await store.set(clearJournalAtom);
    },
  };
});

// ── Compatibility hook ─────────────────────────────────────────────────────
export function useJournalStore(): JournalStoreInterface;
export function useJournalStore<T>(
  selector: (state: JournalStoreInterface) => T,
): T;
export function useJournalStore<T>(
  selector?: (state: JournalStoreInterface) => T,
): JournalStoreInterface | T {
  const combined = useAtomValue(journalCombinedAtom);
  if (!selector) return combined;
  return selector(combined);
}

// Static getState() for non-React code.
export function getJournalState(): JournalStoreInterface {
  return getDefaultStore().get(journalCombinedAtom);
}
