import type { SongDnaStreamEvent } from './types';

/* Consumes the /api/song-dna SSE stream, invoking onEvent for each
   parsed event. Resolves when the stream closes; rejects on network
   error or if the request is aborted via the AbortSignal. */
export async function streamSongDna(
  url: string,
  onEvent: (event: SongDnaStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(url, { signal });
  if (!res.body) throw new Error('SSE response has no body');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    let frameEnd: number;
    while ((frameEnd = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, frameEnd);
      buffer = buffer.slice(frameEnd + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      try {
        const event = JSON.parse(json) as SongDnaStreamEvent;
        onEvent(event);
      } catch {
        // Malformed frame — skip silently rather than abort the stream.
      }
    }
  }
}
