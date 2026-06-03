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
