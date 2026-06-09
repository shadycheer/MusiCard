import { type NextRequest, NextResponse } from 'next/server';
import { getCachedTrack, setCachedTrack, type CachedTrack } from '@/lib/storage/db';
import { fetchAppleMusicTrack } from '@/lib/music/upstream';

export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get('id');
  const country = request.nextUrl.searchParams.get('country');
  const sourceUrl = request.nextUrl.searchParams.get('source') ?? '';

  if (!trackId || !/^\d+$/.test(trackId)) {
    return NextResponse.json({ error: 'invalid track id' }, { status: 400 });
  }
  if (!country || !/^[a-z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'invalid country' }, { status: 400 });
  }

  const cacheKey = `apple:${country}:${trackId}`;

  const cached = await getCachedTrack(cacheKey);
  if (cached) return NextResponse.json(toResponse(cached));

  try {
    const upstream = await fetchAppleMusicTrack(trackId, country, sourceUrl);
    const fresh: CachedTrack = {
      platform: 'appleMusic',
      externalId: trackId,
      country,
      ...upstream,
    };
    void setCachedTrack(cacheKey, fresh);
    return NextResponse.json(toResponse(fresh));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    const status = msg === 'track not found' ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
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
