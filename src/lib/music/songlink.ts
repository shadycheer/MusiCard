import type { Platform } from './url';
import { platforms } from './platforms';
import { getCachedTrack, setCachedTrack } from '@/lib/storage/trackCache';

export type Track = {
  title: string;
  artist: string;
  coverUrl: string;
  sourceUrl: string;
  platform: Platform;
  /* Optional — some upstream responses don't carry album info (e.g.
     NetEase singles). When present, HistoryShelf groups same-album
     tracks into one card. */
  albumId?: string;
  albumName?: string;
};

/* Shared response shape — all four /api/*-track endpoints return
   the same flat fields. albumId/albumName are nullable because some
   upstream responses don't carry album info. */
type TrackApiResponse = {
  title: string;
  artist: string;
  coverUrl: string;
  sourceUrl: string;
  albumId?: string | null;
  albumName?: string | null;
};

/* Single fetcher driven by the platform registry. The shape that used
   to be four near-identical wrappers (one per platform, each repeating
   the same regex → fetch → error-handling → mapping flow) collapses
   to one function — the only per-platform variance is the API route
   and the query params, both supplied by platforms[platform]. */
export async function fetchTrack(
  canonicalUrl: string,
  platform: Platform,
  signal?: AbortSignal,
): Promise<Track> {
  const cached = getCachedTrack(canonicalUrl);
  if (cached) return cached;

  const meta = platforms[platform];
  const query = meta.apiQuery(canonicalUrl);
  if (!query) {
    throw new Error(`${meta.label} 链接里找不到曲目 ID`);
  }

  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`/api/${meta.apiRoute}?${qs}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `查询失败 (${res.status})`);
  }
  const data = (await res.json()) as TrackApiResponse;

  const track: Track = {
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl,
    sourceUrl: data.sourceUrl || canonicalUrl,
    platform,
    albumId: data.albumId ?? undefined,
    albumName: data.albumName ?? undefined,
  };
  setCachedTrack(canonicalUrl, track);
  return track;
}
