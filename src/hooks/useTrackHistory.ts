'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Track } from '@/lib/songlink';

const STORAGE_KEY = 'musicard.history.v1';
const MAX_ENTRIES = 9;

export type HistoryEntry = Track & { visitedAt: number };

/* Persistent local-only history of tracks the user has viewed. Backed
   by localStorage — never round-trips to the server, so no DB cost
   and works offline. Most-recent first, deduped by sourceUrl, capped
   at 9 entries (a clean 3×3 vinyl-shelf grid). */
export function useTrackHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  /* Hydrate from localStorage on mount. Done in useEffect rather than
     useState's initializer so SSR/CSR don't disagree on initial value
     (which would trigger a hydration mismatch warning). */
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const add = useCallback((track: Track) => {
    setHistory((prev) => {
      const dedup = prev.filter((e) => e.sourceUrl !== track.sourceUrl);
      const next: HistoryEntry[] = [
        { ...track, visitedAt: Date.now() },
        ...dedup,
      ].slice(0, MAX_ENTRIES);
      saveHistory(next);
      return next;
    });
  }, []);

  const remove = useCallback((sourceUrl: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.sourceUrl !== sourceUrl);
      saveHistory(next);
      return next;
    });
  }, []);

  return { history, add, remove };
}

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    /* Defensive shape check — older builds might have written entries
       without all fields, or a different platform set. Drop anything
       that doesn't look like an HistoryEntry. */
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          e &&
          typeof e.title === 'string' &&
          typeof e.artist === 'string' &&
          typeof e.coverUrl === 'string' &&
          typeof e.sourceUrl === 'string' &&
          typeof e.platform === 'string' &&
          typeof e.visitedAt === 'number',
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded / private mode — silently drop, history just
    // won't persist this session.
  }
}
