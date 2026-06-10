import type { Track } from '@/lib/music/songlink';

const PREFIX = 'music-card:';
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Entry = { track: Track; cachedAt: number };

export function getCachedTrack(url: string): Track | null {
  try {
    const raw = localStorage.getItem(PREFIX + url);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (Date.now() - entry.cachedAt > TTL_MS) {
      localStorage.removeItem(PREFIX + url);
      return null;
    }
    return entry.track;
  } catch {
    return null;
  }
}

export function setCachedTrack(url: string, track: Track): void {
  try {
    localStorage.setItem(
      PREFIX + url,
      JSON.stringify({ track, cachedAt: Date.now() }),
    );
  } catch {
    // quota exceeded — skip
  }
}

/* Drop a cached track. The trivial path is matching the cache key
   exactly. But QQ's songid URL (`...?songid=12345`) and mid URL
   (`...songDetail/MID`) point to the same song while producing
   different canonical URLs — so the same song can sit in cache under
   two keys, both carrying the same server-canonicalized track.sourceUrl.
   The scan-and-match fallback finds those duplicates and removes
   them all under the one "remove" click. */
export function removeCachedTrack(sourceUrl: string): void {
  try {
    localStorage.removeItem(PREFIX + sourceUrl);
    /* Iterate backwards so concurrent removals don't shift indices
       under us. */
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      if (key === PREFIX + sourceUrl) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const entry = JSON.parse(raw) as Entry;
        if (entry?.track?.sourceUrl === sourceUrl) {
          localStorage.removeItem(key);
        }
      } catch {
        // malformed entry — skip silently
      }
    }
  } catch {
    // private mode — silently drop
  }
}

/* ─── Visit history ───────────────────────────────────────────────────

   The shelf used to be derived from the API cache above, which made
   the cache's 7-day TTL silently evict shelf entries. History is its
   own permanent store now: the cache answers "do we have fresh track
   data", history answers "what has this person listened to". Keyed
   OUTSIDE the cache PREFIX namespace so cache scans never touch it. */

const HISTORY_KEY = 'music-card-history:v1';

type HistoryEntry = { track: Track; visitedAt: number };

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as HistoryEntry[];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (e) =>
        e &&
        typeof e.visitedAt === 'number' &&
        e.track &&
        typeof e.track.title === 'string' &&
        typeof e.track.sourceUrl === 'string',
    );
  } catch {
    return [];
  }
}

function writeHistory(list: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    // quota / private mode — history just doesn't persist
  }
}

/* One-time migration: before HISTORY_KEY existed, the cache WAS the
   history. Seed from whatever cache entries are still alive so the
   shelf doesn't blank out on deploy. Runs at most once — after this
   the key exists (even as just []). */
function migrateHistoryFromCache(): void {
  try {
    if (localStorage.getItem(HISTORY_KEY) !== null) return;
    const seeded = new Map<string, HistoryEntry>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as Entry;
        if (
          !entry ||
          typeof entry.cachedAt !== 'number' ||
          typeof entry.track?.sourceUrl !== 'string'
        ) {
          continue;
        }
        const existing = seeded.get(entry.track.sourceUrl);
        if (!existing || entry.cachedAt > existing.visitedAt) {
          seeded.set(entry.track.sourceUrl, {
            track: entry.track,
            visitedAt: entry.cachedAt,
          });
        }
      } catch {
        // malformed entry — skip silently
      }
    }
    const list = [...seeded.values()].sort((a, b) => b.visitedAt - a.visitedAt);
    writeHistory(list);
  } catch {
    // private mode — skip
  }
}

/* Upsert keyed by sourceUrl (server-canonical, so QQ's songid/mid
   dual-URL problem dedupes here for free). Newest first. */
export function recordHistory(track: Track): void {
  if (typeof window === 'undefined') return;
  migrateHistoryFromCache();
  const rest = readHistory().filter(
    (e) => e.track.sourceUrl !== track.sourceUrl,
  );
  writeHistory([{ track, visitedAt: Date.now() }, ...rest]);
}

/* Full history, newest first. No TTL, no cap — removal is the only
   way an entry leaves the shelf. */
export function getHistoryTracks(): Track[] {
  if (typeof window === 'undefined') return [];
  migrateHistoryFromCache();
  return readHistory().map((e) => e.track);
}

export function removeHistoryTrack(sourceUrl: string): void {
  if (typeof window === 'undefined') return;
  writeHistory(readHistory().filter((e) => e.track.sourceUrl !== sourceUrl));
}
