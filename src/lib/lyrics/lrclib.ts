export type LyricsSourceTag =
  | 'lrclib'
  | 'ai'
  | 'lrclib-miss'
  | 'ai-miss'
  | 'netease'
  | 'qq';

export type LyricsFetchResult = {
  lines: string[] | null;
  source: LyricsSourceTag;
  error?: string;
};

export async function fetchLyricsLrclib(
  track: string,
  artist: string,
  signal?: AbortSignal,
  neteaseId?: string,
  qqMid?: string,
  durationMs?: number,
): Promise<LyricsFetchResult> {
  const params = new URLSearchParams({ title: track, artist });
  if (neteaseId) params.set('neteaseId', neteaseId);
  if (qqMid) params.set('qqMid', qqMid);
  if (durationMs) params.set('durationMs', String(durationMs));
  const res = await fetch(`/api/lyrics?${params.toString()}`, { signal });
  if (!res.ok) {
    const error = `LRCLIB request failed (${res.status})`;
    console.warn(`[lyrics] ${error}`);
    return { lines: null, source: 'lrclib-miss', error };
  }
  const result = (await res.json()) as LyricsFetchResult;
  if (result.error) {
    console.warn(`[lyrics] LRCLIB soft-miss: ${result.error}`);
  }
  return result;
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
    const error = body.error ?? `AI lyrics request failed (${res.status})`;
    console.warn(`[lyrics] AI fallback failed (HTTP ${res.status}): ${error}`);
    return { lines: null, source: 'ai-miss', error };
  }
  const result = (await res.json()) as LyricsFetchResult;
  /* Transient upstream failures come back as 200 + source:'ai-miss'
     + an `error` field (see /api/lyrics route). Surface that to the
     browser console so dev / Sentry / etc. can still see it instead
     of it being silently swallowed by the UI's "no lyrics" branch. */
  if (result.error) {
    console.warn(`[lyrics] AI fallback soft-miss: ${result.error}`);
  }
  return result;
}

export function parseLyrics(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim())
    .filter((line) => line.length > 0);
}
