/**
 * IndexedDB persistence for journal entries & screenshots, with a thin
 * localStorage helper for lightweight settings. All DB access is lazy and
 * guarded so it is a no-op during SSR.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { JournalEntry } from '@/types';

const DB_NAME = 'smc-terminal';
const DB_VERSION = 1;

const STORE_JOURNAL = 'journal';
const STORE_SCREENSHOTS = 'screenshots';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable during SSR'));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_JOURNAL)) {
          const s = db.createObjectStore(STORE_JOURNAL, { keyPath: 'id' });
          s.createIndex('entryTime', 'entryTime');
          s.createIndex('symbol', 'symbol');
        }
        if (!db.objectStoreNames.contains(STORE_SCREENSHOTS)) {
          db.createObjectStore(STORE_SCREENSHOTS, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export const journalDB = {
  async all(): Promise<JournalEntry[]> {
    try {
      const db = await getDB();
      const items = (await db.getAll(STORE_JOURNAL)) as JournalEntry[];
      return items.sort((a, b) => b.entryTime - a.entryTime);
    } catch {
      return [];
    }
  },
  async put(entry: JournalEntry): Promise<void> {
    try {
      const db = await getDB();
      await db.put(STORE_JOURNAL, entry);
    } catch {
      /* ignore offline */
    }
  },
  async remove(id: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete(STORE_JOURNAL, id);
    } catch {
      /* ignore */
    }
  },
  async clear(): Promise<void> {
    try {
      const db = await getDB();
      await db.clear(STORE_JOURNAL);
    } catch {
      /* ignore */
    }
  },
};

export const screenshotDB = {
  async put(id: string, blob: Blob): Promise<void> {
    try {
      const db = await getDB();
      await db.put(STORE_SCREENSHOTS, { id, blob });
    } catch {
      /* ignore */
    }
  },
  async get(id: string): Promise<Blob | null> {
    try {
      const db = await getDB();
      const rec = (await db.get(STORE_SCREENSHOTS, id)) as { blob: Blob } | undefined;
      return rec?.blob ?? null;
    } catch {
      return null;
    }
  },
  async remove(id: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete(STORE_SCREENSHOTS, id);
    } catch {
      /* ignore */
    }
  },
};

/** Type-safe localStorage with JSON encoding, SSR-safe. */
export const localStore = {
  get<T>(key: string, fallback: T): T {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(key: string, value: T): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / private mode */
    }
  },
  remove(key: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
