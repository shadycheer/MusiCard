export type LyricsSourceTag = 'lrclib' | 'ai' | 'lrclib-miss' | 'ai-miss';

export type LyricsFetchResult = {
  lines: string[] | null;
  source: LyricsSourceTag;
  error?: string;
};

export async function fetchLyricsLrclib(
  track: string,
  artist: string,
  signal?: AbortSignal,
): Promise<LyricsFetchResult> {
  const url = `/api/lyrics?title=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    return {
      lines: null,
      source: 'lrclib-miss',
      error: `LRCLIB request failed (${res.status})`,
    };
  }
  return (await res.json()) as LyricsFetchResult;
}

export async function fetchLyricsAi(
  track: string,
  artist: string,
  signal?: AbortSignal,
): Promise<LyricsFetchResult> {
  const url = `/api/lyrics?title=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}&phase=ai`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      lines: null,
      source: 'ai-miss',
      error: body.error ?? `AI lyrics request failed (${res.status})`,
    };
  }
  return (await res.json()) as LyricsFetchResult;
}

export function parseLyrics(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim())
    .filter((line) => line.length > 0);
}
