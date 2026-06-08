import type { Track } from './songlink';

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

/* Drop a single cached track. Used by the history shelf's remove button —
   since the cache IS the history list, deleting from cache is the same as
   "forget this from my recent." */
export function removeCachedTrack(url: string): void {
  try {
    localStorage.removeItem(PREFIX + url);
  } catch {
    // private mode — silently drop
  }
}

/* "Recent" view derived directly from the cache. No separate history
   storage — the cache already records "this URL was visited at cachedAt",
   so we just scan + sort + drop-expired. Opportunistically GCs expired
   entries during the scan so the cache doesn't grow unbounded. */
export function getRecentTracks(limit = 9): Track[] {
  if (typeof window === 'undefined') return [];
  const now = Date.now();
  const collected: { track: Track; cachedAt: number }[] = [];
  try {
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
          !entry.track ||
          typeof entry.track.title !== 'string'
        ) {
          continue;
        }
        if (now - entry.cachedAt > TTL_MS) {
          localStorage.removeItem(key);
          continue;
        }
        collected.push({ track: entry.track, cachedAt: entry.cachedAt });
      } catch {
        // malformed entry — skip silently
      }
    }
  } catch {
    return [];
  }
  collected.sort((a, b) => b.cachedAt - a.cachedAt);
  return collected.slice(0, limit).map((e) => e.track);
}
