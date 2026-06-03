import { type NextRequest, NextResponse } from 'next/server';
import { getCachedTrack, setCachedTrack, type CachedTrack } from '@/lib/db';

const ENDPOINT = 'https://itunes.apple.com/lookup';

type ItunesResult = {
  trackName: string;
  artistName: string;
  artworkUrl100: string;
  trackViewUrl?: string;
};

type ItunesResponse = {
  resultCount: number;
  results: ItunesResult[];
};

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
    const apiUrl = `${ENDPOINT}?id=${trackId}&country=${country}&entity=song`;
    const res = await fetch(apiUrl);
    if (!res.ok) {
      return NextResponse.json(
        { error: `iTunes returned ${res.status}` },
        { status: res.status },
      );
    }
    const data = (await res.json()) as ItunesResponse;
    const item = data.results?.[0];
    if (!data.resultCount || !item) {
      return NextResponse.json({ error: 'track not found' }, { status: 404 });
    }

    const coverUrl = item.artworkUrl100.replace(
      /\/\d+x\d+bb\.(jpg|png)$/,
      '/600x600bb.$1',
    );

    const fresh: CachedTrack = {
      platform: 'appleMusic',
      externalId: trackId,
      country,
      title: item.trackName,
      artist: item.artistName,
      coverUrl,
      sourceUrl: item.trackViewUrl ?? sourceUrl,
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
