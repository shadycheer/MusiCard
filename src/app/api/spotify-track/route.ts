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

  const cacheKey = `spotify:${trackId}`;

  const cached = await getCachedTrack(cacheKey);
  if (cached) return NextResponse.json(toResponse(cached));

  try {
    const token = await getAccessToken();
    const res = await fetch(`${SPOTIFY_API_BASE}/tracks/${trackId}`, {
      headers: { Authorization: `Bearer ${token}` },
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
