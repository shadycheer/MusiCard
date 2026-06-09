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

/* "Recent" view derived directly from the cache. No separate history
   storage — the cache already records "this URL was visited at cachedAt",
   so we just scan + sort + drop-expired. Opportunistically GCs:
   - expired entries (cachedAt past TTL)
   - duplicate entries pointing to the same track.sourceUrl (different
     cache key, same actual song — see removeCachedTrack for why) */
export function getRecentTracks(limit = 9): Track[] {
  if (typeof window === 'undefined') return [];
  const now = Date.now();
  const collected: { track: Track; cachedAt: number; key: string }[] = [];
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
          typeof entry.track.title !== 'string' ||
          typeof entry.track.sourceUrl !== 'string'
        ) {
          continue;
        }
        if (now - entry.cachedAt > TTL_MS) {
          localStorage.removeItem(key);
          continue;
        }
        collected.push({ track: entry.track, cachedAt: entry.cachedAt, key });
      } catch {
        // malformed entry — skip silently
      }
    }
  } catch {
    return [];
  }

  /* Dedupe by track.sourceUrl (the server-canonical URL). When the
     same song was cached under two different request URLs — e.g., a
     QQ songid paste and a QQ mid paste resolving to the same song —
     keep the newest entry and GC the rest. */
  const bestBySourceUrl = new Map<string, typeof collected[number]>();
  for (const c of collected) {
    const existing = bestBySourceUrl.get(c.track.sourceUrl);
    if (!existing) {
      bestBySourceUrl.set(c.track.sourceUrl, c);
      continue;
    }
    if (c.cachedAt > existing.cachedAt) {
      try { localStorage.removeItem(existing.key); } catch { /* ignore */ }
      bestBySourceUrl.set(c.track.sourceUrl, c);
    } else {
      try { localStorage.removeItem(c.key); } catch { /* ignore */ }
    }
  }

  const deduped = [...bestBySourceUrl.values()];
  deduped.sort((a, b) => b.cachedAt - a.cachedAt);
  return deduped.slice(0, limit).map((e) => e.track);
}
