import type { Platform } from './musicUrl';
import { fetchAppleMusicTrack } from './itunes';
import { getCachedTrack, setCachedTrack } from './trackCache';

export type Track = {
  title: string;
  artist: string;
  coverUrl: string;
  sourceUrl: string;
  platform: Platform;
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
  const data = (await res.json()) as {
    title: string;
    artist: string;
    coverUrl: string;
    sourceUrl: string;
  };

  return {
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl,
    sourceUrl: data.sourceUrl || canonicalUrl,
    platform: 'spotify',
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
  const data = (await res.json()) as {
    title: string;
    artist: string;
    coverUrl: string;
    sourceUrl: string;
  };

  return {
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl,
    sourceUrl: data.sourceUrl || canonicalUrl,
    platform: 'netease',
  };
}
