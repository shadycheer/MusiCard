/**
 * Thin wrappers around Spotify / iTunes APIs. Pure functions — no caching,
 * no DB. The routes and the cron refresher both call these.
 */

import type { CachedTrack } from '@/lib/storage/db';
import { fetchSongDetailViaWeapi } from './netease';

type UpstreamFields = Pick<
  CachedTrack,
  | 'title'
  | 'artist'
  | 'coverUrl'
  | 'sourceUrl'
  | 'locale'
  | 'albumId'
  | 'albumName'
  | 'durationMs'
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
  album: {
    id: string;
    name: string;
    images: Array<{ url: string; height: number }>;
  };
  external_urls: { spotify: string };
  duration_ms?: number;
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
    albumId: track.album.id,
    albumName: track.album.name,
    durationMs: track.duration_ms ?? null,
  };
}

type ItunesResult = {
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  trackViewUrl?: string;
  collectionId?: number;
  collectionName?: string;
  trackTimeMillis?: number;
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
    albumId: item.collectionId ? String(item.collectionId) : undefined,
    albumName: item.collectionName ?? undefined,
    durationMs: item.trackTimeMillis ?? null,
  };
}

/** Fetch NetEase track metadata via the community-reverse-engineered weapi
 *  protocol. See `netease.ts` for protocol details and the rationale
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
    albumId: track.albumId || undefined,
    albumName: track.albumName || undefined,
    durationMs: track.durationMs ?? null,
  };
}

/** Fetch QQ Music track via the public fcg endpoint. The endpoint is
 *  uncredentialled but requires a Referer header — QQ rejects calls
 *  without it. Cover URL is templated off the album mid (T002R format
 *  is the album-cover bucket). */
const QQ_FCG = 'https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg';
const QQ_LYRIC_FCG = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg';

type QqSongResponse = {
  code: number;
  data?: Array<{
    mid: string;
    name: string;
    singer: Array<{ mid?: string; name: string }>;
    album: { mid: string; name: string };
    /* Runtime in SECONDS (QQ's convention), unlike everyone else's ms. */
    interval?: number;
  }>;
};

export async function fetchQqMusicTrack(songIdOrMid: string): Promise<UpstreamFields> {
  /* The fcg endpoint takes either songmid (14-char base62) or songid
     (numeric) depending on which the share URL exposed. All-digits → id,
     anything else → mid. We canonicalize the sourceUrl to the mid form
     either way, since songDetail/{mid} is the public-facing share link. */
  const param = /^\d+$/.test(songIdOrMid) ? 'songid' : 'songmid';
  const url = `${QQ_FCG}?${param}=${songIdOrMid}&format=json&platform=yqq&inCharset=utf-8&outCharset=utf-8`;
  const res = await fetch(url, { headers: { Referer: 'https://y.qq.com/' } });
  if (!res.ok) throw new Error(`QQ Music returned ${res.status}`);
  const data = (await res.json()) as QqSongResponse;
  if (data.code !== 0 || !data.data?.[0]) throw new Error('track not found');
  const song = data.data[0];

  /* Cover URL priority: album cover (T002R) → singer cover (T001R).
     QQ singles like remixes often come back with album.mid empty,
     which would otherwise render as a 404'd white square. The singer
     mid is almost always present in those cases. */
  const albumMid = song.album.mid;
  const singerMid = song.singer.find((s) => s.mid)?.mid;
  const coverUrl = albumMid
    ? `https://y.qq.com/music/photo_new/T002R800x800M000${albumMid}.jpg`
    : singerMid
      ? `https://y.qq.com/music/photo_new/T001R800x800M000${singerMid}.jpg`
      : '';

  /* Always emit songDetail/{songmid} — that's the canonical share URL
     QQ Music itself produces. The trackToSlug helper reads this back to
     route the track from history. */
  const canonicalMid = song.mid || songIdOrMid;
  return {
    locale: null,
    title: song.name,
    artist: song.singer.map((s) => s.name).join(', '),
    coverUrl,
    sourceUrl: `https://y.qq.com/n/ryqq/songDetail/${canonicalMid}`,
    albumId: song.album.mid || undefined,
    albumName: song.album.name || undefined,
    durationMs: song.interval ? song.interval * 1000 : null,
  };
}

/** Fetch QQ Music lyrics by songmid. The fcg lyric endpoint returns LRC-
 *  formatted text (`[mm:ss.xx]line`) plus an optional translation block.
 *  Parsing mirrors fetchLyricViaWeapi in netease.ts — strip time
 *  tags + LRC metadata, drop credit lines. Returns null on any failure
 *  so the caller can fall through to the AI source. */
export async function fetchQqLyrics(songMid: string): Promise<string[] | null> {
  const url = `${QQ_LYRIC_FCG}?songmid=${songMid}&format=json&nobase64=1`;
  try {
    const res = await fetch(url, { headers: { Referer: 'https://y.qq.com/' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { code?: number; lyric?: string };
    if (data.code !== 0 || !data.lyric) return null;
    const lines = data.lyric
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/, '')
          .replace(/^\s*\[(?:ti|ar|al|by|offset|length):[^\]]*\]\s*$/i, '')
          .trim(),
      )
      .filter((line) => line.length > 0)
      .filter(
        (line) =>
          !/^(作词|作曲|编曲|制作|出品|监制|混音|母带|录音|和声|吉他|贝斯|鼓|键盘)\s*[：:]/i.test(
            line,
          ),
      );
    return lines.length > 0 ? lines : null;
  } catch {
    return null;
  }
}
