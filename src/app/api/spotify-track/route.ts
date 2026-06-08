import { type NextRequest, NextResponse } from 'next/server';
import { getCachedTrack, setCachedTrack, type CachedTrack } from '@/lib/db';
import { fetchSpotifyTrack, pickLocaleBucket } from '@/lib/upstream';

export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get('id');
  if (!trackId || !/^[A-Za-z0-9]{22}$/.test(trackId)) {
    return NextResponse.json({ error: 'invalid track id' }, { status: 400 });
  }

  const { header: acceptLanguage, bucket } = pickLocaleBucket(
    request.headers.get('accept-language'),
  );
  const cacheKey = `spotify:${bucket}:${trackId}`;

  const cached = await getCachedTrack(cacheKey);
  if (cached) return NextResponse.json(toResponse(cached));

  try {
    const upstream = await fetchSpotifyTrack(trackId, acceptLanguage);
    const fresh: CachedTrack = {
      platform: 'spotify',
      externalId: trackId,
      country: null,
      ...upstream,
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
    albumId: t.albumId ?? null,
    albumName: t.albumName ?? null,
  };
}
