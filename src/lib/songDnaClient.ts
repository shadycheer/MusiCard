import type {
  Citation,
  SongDnaFound,
  SongDnaStreamEvent,
} from './songDnaTypes';

/* Consumes the /api/song-dna SSE stream, invoking onEvent for each
   parsed event. Resolves when the stream closes; rejects on network error
   or if the request is aborted via the AbortSignal. */
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

/* Walks a SongDnaFound payload and assigns each unique citation URL a
   stable 1-based number. Same URL reused across dimensions → same number.
   Returns { numberOf(url), registry } for rendering. */
export function buildCitationRegistry(payload: SongDnaFound): {
  numberOf: (url: string) => number;
  registry: Citation[];
} {
  const map = new Map<string, { number: number; citation: Citation }>();

  const visit = (cs: Citation[] | undefined) => {
    if (!cs) return;
    for (const c of cs) {
      if (!map.has(c.url)) {
        map.set(c.url, { number: map.size + 1, citation: c });
      }
    }
  };

  if (payload.identity) {
    visit(payload.identity.album?.citations);
    visit(payload.identity.releaseDate?.citations);
    visit(payload.identity.label?.citations);
    visit(payload.identity.duration?.citations);
  }
  if (payload.credits) {
    visit(payload.credits.lyrics?.citations);
    visit(payload.credits.composition?.citations);
    visit(payload.credits.arrangement?.citations);
    visit(payload.credits.production?.citations);
    visit(payload.credits.studio?.citations);
    visit(payload.credits.musicians?.citations);
    visit(payload.credits.engineers?.citations);
  }
  if (payload.making) {
    visit(payload.making.inspiration?.citations);
    visit(payload.making.writing?.citations);
    visit(payload.making.recording?.citations);
  }
  if (payload.legacy) {
    visit(payload.legacy.commercial?.citations);
    visit(payload.legacy.awards?.citations);
    visit(payload.legacy.covers?.citations);
    visit(payload.legacy.mediaUse?.citations);
    visit(payload.legacy.impact?.citations);
  }

  const numberOf = (url: string): number => map.get(url)?.number ?? 0;
  const registry = [...map.values()]
    .sort((a, b) => a.number - b.number)
    .map((e) => e.citation);

  return { numberOf, registry };
}
