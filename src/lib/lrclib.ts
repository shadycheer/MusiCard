export async function fetchLyrics(
  track: string,
  artist: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const url = `/api/lyrics?title=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Lyrics request failed (${res.status})`);
  const data = (await res.json()) as { lines: string[] | null };
  return data.lines;
}

export function parseLyrics(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim())
    .filter((line) => line.length > 0);
}
