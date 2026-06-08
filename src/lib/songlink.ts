import type { Platform } from './musicUrl';
import { fetchAppleMusicTrack } from './itunes';
import { getCachedTrack, setCachedTrack } from './trackCache';

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

export async function fetchTrack(
  canonicalUrl: string,
  platform: Platform,
  signal?: AbortSignal,
): Promise<Track> {
  const cached = getCachedTrack(canonicalUrl);
  if (cached) return cached;

  const track =
    platform === 'appleMusic'
      ? await fetchAppleMusicTrack(canonicalUrl, signal)
      : platform === 'netease'
        ? await fetchNeteaseTrack(canonicalUrl, signal)
        : await fetchSpotifyTrack(canonicalUrl, signal);

  setCachedTrack(canonicalUrl, track);
  return track;
}

async function fetchSpotifyTrack(
  canonicalUrl: string,
  signal?: AbortSignal,
): Promise<Track> {
  const match = canonicalUrl.match(/\/track\/([A-Za-z0-9]{22})/);
  if (!match) throw new Error('Spotify URL missing track id');
  const trackId = match[1];

  const res = await fetch(`/api/spotify-track?id=${trackId}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `查询失败 (${res.status})`);
  }
  const data = (await res.json()) as TrackApiResponse;

  return {
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl,
    sourceUrl: data.sourceUrl || canonicalUrl,
    platform: 'spotify',
    albumId: data.albumId ?? undefined,
    albumName: data.albumName ?? undefined,
  };
}

async function fetchNeteaseTrack(
  canonicalUrl: string,
  signal?: AbortSignal,
): Promise<Track> {
  const match = canonicalUrl.match(/\bid=(\d+)/);
  if (!match) throw new Error('NetEase URL missing track id');
  const trackId = match[1];

  const res = await fetch(`/api/netease-track?id=${trackId}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `查询失败 (${res.status})`);
  }
  const data = (await res.json()) as TrackApiResponse;

  return {
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl,
    sourceUrl: data.sourceUrl || canonicalUrl,
    platform: 'netease',
    albumId: data.albumId ?? undefined,
    albumName: data.albumName ?? undefined,
  };
}

/* Shared response shape — all three /api/*-track endpoints return
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
