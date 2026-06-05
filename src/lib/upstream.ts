/**
 * Thin wrappers around Spotify / iTunes APIs. Pure functions — no caching,
 * no DB. The routes and the cron refresher both call these.
 */

import type { CachedTrack } from './db';
import { fetchSongDetailViaWeapi } from './neteaseWeapi';

type UpstreamFields = Pick<
  CachedTrack,
  'title' | 'artist' | 'coverUrl' | 'sourceUrl' | 'locale'
>;

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const ITUNES_API = 'https://itunes.apple.com/lookup';

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify token endpoint returned ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

export function pickLocaleBucket(acceptLanguage: string | null): {
  header: string;
  bucket: string;
} {
  const first = acceptLanguage?.split(',')[0]?.trim();
  if (!first) return { header: 'zh-TW', bucket: 'zh' };
  const major = first.split('-')[0].toLowerCase();
  return { header: first, bucket: major };
}

// Map a stored bucket back to a sensible Accept-Language for refresh calls.
// Spotify accepts both "zh" and "zh-TW" — using the regional variant gives
// more consistent results.
const BUCKET_TO_HEADER: Record<string, string> = {
  zh: 'zh-TW',
  ja: 'ja-JP',
  ko: 'ko-KR',
  en: 'en-US',
};

export function bucketToHeader(bucket: string | null): string {
  if (!bucket) return 'zh-TW';
  return BUCKET_TO_HEADER[bucket] ?? `${bucket}-${bucket.toUpperCase()}`;
}

type SpotifyApiTrack = {
  name: string;
  artists: Array<{ name: string }>;
  album: { images: Array<{ url: string; height: number }> };
  external_urls: { spotify: string };
};

export async function fetchSpotifyTrack(
  trackId: string,
  acceptLanguage: string,
): Promise<UpstreamFields> {
  const token = await getSpotifyToken();
  const res = await fetch(`${SPOTIFY_API_BASE}/tracks/${trackId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Accept-Language': acceptLanguage,
    },
  });
  if (!res.ok) throw new Error(`Spotify API returned ${res.status}`);
  const track = (await res.json()) as SpotifyApiTrack;
  const cover = [...track.album.images].sort((a, b) => b.height - a.height)[0];

  return {
    locale: pickLocaleBucket(acceptLanguage).bucket,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    coverUrl: cover?.url ?? '',
    sourceUrl: track.external_urls.spotify,
  };
}

type ItunesResult = {
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  trackViewUrl?: string;
};

export async function fetchAppleMusicTrack(
  trackId: string,
  country: string,
  fallbackSourceUrl: string,
): Promise<UpstreamFields> {
  const res = await fetch(
    `${ITUNES_API}?id=${trackId}&country=${country}&entity=song`,
  );
  if (!res.ok) throw new Error(`iTunes returned ${res.status}`);
  const data = (await res.json()) as {
    resultCount: number;
    results: ItunesResult[];
  };
  const item = data.results?.[0];
  if (!data.resultCount || !item) throw new Error('track not found');

  const coverUrl = item.artworkUrl100.replace(
    /\/\d+x\d+bb\.(jpg|png)$/,
    '/600x600bb.$1',
  );

  return {
    locale: null,
    title: item.trackName,
    artist: item.artistName,
    coverUrl,
    sourceUrl: item.trackViewUrl ?? fallbackSourceUrl,
  };
}

/** Fetch NetEase track metadata via the community-reverse-engineered weapi
 *  protocol. See `neteaseWeapi.ts` for protocol details and the rationale
 *  for going around NetEase's OpenAPI (which requires per-AppId device
 *  registration plus user OAuth even for read-only metadata). */
export async function fetchNeteaseTrack(songId: string): Promise<UpstreamFields> {
  const track = await fetchSongDetailViaWeapi(songId);
  return {
    locale: null,
    title: track.title,
    artist: track.artist,
    coverUrl: track.coverUrl,
    sourceUrl: `https://music.163.com/song?id=${songId}`,
  };
}
