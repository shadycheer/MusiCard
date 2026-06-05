import { type NextRequest } from 'next/server';
import {
  getCachedSongDna,
  setCachedSongDna,
  incrementSongDnaHit,
  songDnaCacheKey,
} from '@/lib/db';
import type {
  SongDnaPayload,
  SongDnaStreamEvent,
} from '@/lib/songDnaTypes';

export const runtime = 'edge';
export const maxDuration = 60;

const MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-pro';
const HAS_DATA_FALSE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const title = params.get('title');
  const artist = params.get('artist');
  const platform = params.get('platform');
  const sourceUrl = params.get('sourceUrl');
  const album = params.get('album') ?? undefined;
  const refresh = params.get('refresh') === 'true';
  void album; // held for Task 4

  if (!title || !artist || !platform || !sourceUrl) {
    return new Response(
      JSON.stringify({ error: 'title, artist, platform, sourceUrl required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SongDnaStreamEvent) => {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        const cacheKey = songDnaCacheKey(title, artist);

        // ─── Cache lookup ───────────────────────────────────
        if (!refresh) {
          const cached = await getCachedSongDna(cacheKey);
          if (cached) {
            const cachedAtMs = new Date(cached.cachedAt).getTime();
            const isFresh =
              cached.payload.hasData ||
              Date.now() - cachedAtMs < HAS_DATA_FALSE_TTL_MS;
            if (isFresh) {
              send({
                kind: 'final',
                payload: cached.payload,
                cached: true,
                cachedAt: cached.cachedAt,
              });
              void incrementSongDnaHit(cacheKey);
              controller.close();
              return;
            }
          }
        }

        // ─── LLM call (stub for Task 3; real implementation in Task 4) ───
        send({ kind: 'status', phase: 'started' });

        // TASK 4 PLACEHOLDER — replace with real OpenRouter streaming call
        const payload: SongDnaPayload = { hasData: false };
        await setCachedSongDna(cacheKey, title, artist, payload, MODEL);
        send({ kind: 'final', payload, cached: false });
        controller.close();
      } catch (err) {
        send({
          kind: 'error',
          message: err instanceof Error ? err.message : 'unknown error',
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
