'use client';
import { useReplayPlayback } from '@/hooks/useReplayPlayback';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useSmcEngine } from '@/hooks/useSmcEngine';
import { useTradeRuntime } from '@/hooks/useTradeRuntime';
import { useJournalStore } from '@/store/journalStore';
import { useEffect } from 'react';

/**
 * Headless component that mounts global runtime loops: the replay clock,
 * keyboard shortcuts, and the SMC recompute pipeline. Render once at the root.
 */
export function GlobalRuntime() {
  useReplayPlayback();
  useHotkeys();
  useSmcEngine();
  useTradeRuntime();

  // Hydrate the journal from IndexedDB once on mount.
  const loadJournal = useJournalStore((s) => s.load);
  useEffect(() => {
    void loadJournal();
  }, [loadJournal]);

  return null;
}
