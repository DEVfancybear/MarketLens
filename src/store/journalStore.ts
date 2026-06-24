'use client';
import { create } from 'zustand';
import type { JournalEntry, ScreenshotRef } from '@/types';
import { journalDB, screenshotDB } from '@/services/storage';

interface JournalState {
  entries: JournalEntry[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (entry: JournalEntry) => Promise<void>;
  update: (id: string, patch: Partial<JournalEntry>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  attachScreenshot: (id: string, ref: ScreenshotRef, blob: Blob) => Promise<void>;
  clear: () => Promise<void>;
}

export const useJournalStore = create<JournalState>((set, get) => ({
  entries: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const entries = await journalDB.all();
    set({ entries, loaded: true });
  },

  add: async (entry) => {
    set({ entries: [entry, ...get().entries] });
    await journalDB.put(entry);
  },

  update: async (id, patch) => {
    const entries = get().entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    set({ entries });
    const updated = entries.find((e) => e.id === id);
    if (updated) await journalDB.put(updated);
  },

  remove: async (id) => {
    const entry = get().entries.find((e) => e.id === id);
    entry?.screenshots?.forEach((s) => screenshotDB.remove(s.id));
    set({ entries: get().entries.filter((e) => e.id !== id) });
    await journalDB.remove(id);
  },

  attachScreenshot: async (id, ref, blob) => {
    await screenshotDB.put(ref.id, blob);
    const entry = get().entries.find((e) => e.id === id);
    if (!entry) return;
    const screenshots = [...(entry.screenshots ?? []), ref];
    await get().update(id, { screenshots });
  },

  clear: async () => {
    set({ entries: [] });
    await journalDB.clear();
  },
}));
