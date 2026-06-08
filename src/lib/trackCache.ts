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

/* Re-fetch one cached track from its platform's /api endpoint to pick up
   album metadata. The API self-heals stale DB rows, so this also fixes
   the server-side cache as a side effect. Returns the updated Track or
   null on failure (network, malformed URL, missing album). */
async function fetchAlbumMeta(track: Track, signal?: AbortSignal): Promise<Track | null> {
  try {
    if (track.platform === 'spotify') {
      const m = track.sourceUrl.match(/\/track\/([A-Za-z0-9]{22})/);
      if (!m) return null;
      const res = await fetch(`/api/spotify-track?id=${m[1]}`, { signal });
      if (!res.ok) return null;
      const data = (await res.json()) as { albumId?: string | null; albumName?: string | null };
      if (!data.albumName) return null;
      return {
        ...track,
        albumId: data.albumId ?? undefined,
        albumName: data.albumName,
      };
    }
    if (track.platform === 'netease') {
      const m = track.sourceUrl.match(/\bid=(\d+)/);
      if (!m) return null;
      const res = await fetch(`/api/netease-track?id=${m[1]}`, { signal });
      if (!res.ok) return null;
      const data = (await res.json()) as { albumId?: string | null; albumName?: string | null };
      if (!data.albumName) return null;
      return {
        ...track,
        albumId: data.albumId ?? undefined,
        albumName: data.albumName,
      };
    }
    if (track.platform === 'appleMusic') {
      const url = new URL(track.sourceUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      const country = parts[0];
      const trackId = url.searchParams.get('i') ?? parts[3];
      if (!trackId || !country || !/^[a-z]{2}$/.test(country) || !/^\d+$/.test(trackId)) {
        return null;
      }
      const res = await fetch(
        `/api/apple-music-track?id=${trackId}&country=${country}&source=${encodeURIComponent(track.sourceUrl)}`,
        { signal },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { albumId?: string | null; albumName?: string | null };
      if (!data.albumName) return null;
      return {
        ...track,
        albumId: data.albumId ?? undefined,
        albumName: data.albumName,
      };
    }
  } catch {
    return null;
  }
  return null;
}

/* One-shot backfill: re-fetch any recent track missing album metadata so
   the shelf can group same-album entries. Entries cached before the
   2026-06-09 schema bump pre-date the albumName field — backfilling on
   home mount means the UI eventually heals itself even for users who
   only had old data. Bounded by `limit` to avoid hammering APIs. */
export async function backfillAlbumMeta(limit = 12): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const recent = getRecentTracks(limit);
  const missing = recent.filter((t) => !t.albumName && t.artist);
  if (missing.length === 0) return false;
  const results = await Promise.allSettled(
    missing.map((t) => fetchAlbumMeta(t)),
  );
  let updated = false;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) {
      setCachedTrack(missing[i].sourceUrl, r.value);
      updated = true;
    }
  });
  return updated;
}
