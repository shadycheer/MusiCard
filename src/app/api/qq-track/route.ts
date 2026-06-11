import { type NextRequest, NextResponse } from 'next/server';
import { getCachedTrack, setCachedTrack, type CachedTrack } from '@/lib/storage/db';
import { fetchQqMusicTrack } from '@/lib/music/upstream';

export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get('id');
  if (!trackId || !/^[A-Za-z0-9]+$/.test(trackId)) {
    return NextResponse.json({ error: 'invalid track id' }, { status: 400 });
  }

  const cacheKey = `qq:${trackId}`;
  const cached = await getCachedTrack(cacheKey);
  if (cached) return NextResponse.json(toResponse(cached));

  try {
    const upstream = await fetchQqMusicTrack(trackId);
    const fresh: CachedTrack = {
      platform: 'qqMusic',
      externalId: trackId,
      country: null,
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
    durationMs: t.durationMs ?? null,
  };
}
