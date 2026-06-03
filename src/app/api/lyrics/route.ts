import { type NextRequest, NextResponse } from 'next/server';
import { getCachedLyrics, setCachedLyrics, lyricsCacheKey } from '@/lib/db';

const LRCLIB_ENDPOINT = 'https://lrclib.net/api/get';

type LrcLibResponse = {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get('title');
  const artist = request.nextUrl.searchParams.get('artist');
  if (!title || !artist) {
    return NextResponse.json({ error: 'missing title or artist' }, { status: 400 });
  }

  const cacheKey = lyricsCacheKey(title, artist);

  const cached = await getCachedLyrics(cacheKey);
  if (cached) {
    return NextResponse.json({
      lines: cached.source === 'lrclib-miss' ? null : cached.lines,
    });
  }

  try {
    const url = `${LRCLIB_ENDPOINT}?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetch(url);

    if (res.status === 404) {
      // Cache the miss so songs without lyrics don't keep hitting LRCLIB.
      void setCachedLyrics(cacheKey, title, artist, [], 'lrclib-miss');
      return NextResponse.json({ lines: null });
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: `LRCLIB returned ${res.status}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as LrcLibResponse;
    const raw = data.plainLyrics?.trim();
    if (!raw) {
      void setCachedLyrics(cacheKey, title, artist, [], 'lrclib-miss');
      return NextResponse.json({ lines: null });
    }

    const lines = parseLyricsRaw(raw);
    void setCachedLyrics(cacheKey, title, artist, lines, 'lrclib');
    return NextResponse.json({ lines });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    );
  }
}

function parseLyricsRaw(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim(),
    )
    .filter((line) => line.length > 0);
}
