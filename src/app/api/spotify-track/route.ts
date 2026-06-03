import { type NextRequest, NextResponse } from 'next/server';
import { getCachedTrack, setCachedTrack, type CachedTrack } from '@/lib/db';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

type CachedToken = { accessToken: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
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

type SpotifyTrack = {
  name: string;
  artists: Array<{ name: string }>;
  album: { images: Array<{ url: string; height: number }> };
  external_urls: { spotify: string };
};

export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get('id');
  if (!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)) {
    return NextResponse.json({ error: 'invalid track id' }, { status: 400 });
  }

  const { header: acceptLanguage, bucket: localeBucket } =
    pickLocale(request);
  const cacheKey = `spotify:${localeBucket}:${trackId}`;

  const cached = await getCachedTrack(cacheKey);
  if (cached) return NextResponse.json(toResponse(cached));

  try {
    const token = await getAccessToken();
    // Accept-Language triggers Spotify's Localized Names feature — Asian
    // artists come back in their registered script (e.g. 陳綺貞 instead of
    // Cheer Chen). Artists without a localized name fall back to canonical.
    const res = await fetch(`${SPOTIFY_API_BASE}/tracks/${trackId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Accept-Language': acceptLanguage,
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Spotify API returned ${res.status}` },
        { status: res.status },
      );
    }
    const track = (await res.json()) as SpotifyTrack;
    const cover = [...track.album.images].sort((a, b) => b.height - a.height)[0];

    const fresh: CachedTrack = {
      platform: 'spotify',
      externalId: trackId,
      country: null,
      locale: localeBucket,
      title: track.name,
      artist: track.artists.map((a) => a.name).join(', '),
      coverUrl: cover?.url ?? '',
      sourceUrl: track.external_urls.spotify,
    };

    void setCachedTrack(cacheKey, fresh);
    return NextResponse.json(toResponse(fresh));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    );
  }
}

function toResponse(t: CachedTrack) {
  return {
    title: t.title,
    artist: t.artist,
    coverUrl: t.coverUrl,
    sourceUrl: t.sourceUrl,
  };
}

/**
 * Picks the locale from the request's Accept-Language header.
 * Returns:
 *   - `header`: the value to forward to Spotify (full BCP47, e.g. "zh-CN")
 *   - `bucket`: the major language code for cache bucketing (e.g. "zh")
 *
 * zh-CN and zh-TW share a cache bucket because Spotify returns identical
 * data for both (artists register a single localized name per major language).
 */
function pickLocale(request: NextRequest): { header: string; bucket: string } {
  const first = request.headers
    .get('accept-language')
    ?.split(',')[0]
    ?.trim();
  if (!first) return { header: 'zh-TW', bucket: 'zh' };
  const major = first.split('-')[0].toLowerCase();
  return { header: first, bucket: major };
}
