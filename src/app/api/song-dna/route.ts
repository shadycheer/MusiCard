import { type NextRequest } from 'next/server';
import { Agent, fetch as undiciFetch } from 'undici';
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

/* Undici's defaults are too tight for openrouter.ai + web_search from
   networks where the international TLS handshake or the pre-token search
   gap can be slow (notably mainland China). 300s connect window covers
   pathological handshakes; 60s headers covers slow first byte after
   web_search runs server-side; bodyTimeout 0 lets the body stream as long
   as the model needs to write a full essay. We use undici's own fetch
   (not globalThis.fetch) so Agent and fetch share the same Dispatcher
   class — passing this Agent to global fetch trips UND_ERR_INVALID_ARG
   because node's internal undici and our installed undici are separate
   instances. */
const openrouterAgent = new Agent({
  connect: { timeout: 300_000 },
  headersTimeout: 60_000,
  bodyTimeout: 0,
});

// nodejs runtime: edge runtime + long-lived streaming + the openrouter
// web_search server tool was producing intermittent undici "fetch failed"
// errors when the upstream paused mid-search. Node's fetch is more
// tolerant of the slow pre-content gap on tool-augmented runs.
export const runtime = 'nodejs';
export const maxDuration = 120;

const MODEL = (
  process.env.OPENROUTER_SONG_DNA_MODEL ?? 'deepseek/deepseek-v4-pro'
).replace(/:online$/, '');
const HAS_DATA_FALSE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const WEB_SEARCH_TOOL = {
  type: 'openrouter:web_search',
  parameters: {
    engine: 'exa',
    max_results: 3,
    max_total_results: 5,
    search_context_size: 'low',
    excluded_domains: ['hifiii.com', 'factpedia.org'],
  },
};

type UpstreamChunk = {
  choices?: Array<{
    delta?: {
      role?: string;
      content?: string;
      annotations?: Array<{
        type?: string;
        url_citation?: { url?: string; title?: string };
      }>;
    };
    message?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
};

const SYSTEM_PROMPT = `你是一位音乐编辑，给一首歌写一篇有故事感的短文 —— 挖掘背后的来龙去脉，不写百科罗列。

工作方式：
- 你可以主动联网检索。最多 2 次搜索；拿到能撑起一篇短文的资料就停止检索开始写。
- 文里每一个具体事实（年份、人物、事件、商业数据等）都必须基于搜索结果，不许凭记忆编造。
- 拿不到任何可信资料时，只回复一行：HASDATA:FALSE

写作要求：
- 输出 Markdown 中文短文，600–1100 字。
- 结构由你决定，但建议：先抛一个有钩子的开头（不是营销标题）→ 展开背景/创作/转折/传播 → 给一个能用于分享的判断。
- 用小标题（## 二级标题）把段落组织起来；段落之间空行。
- 重要事实在句末用 [n] 标注引用，例如：这首歌发行于 2007 年[1]。
- 文末固定一段叫「## 参考资料」，用 Markdown 列表列出每个编号对应的链接：
  - [1] [文章标题](https://example.com)
  - [2] [文章标题](https://another.com)
- 不要写"树立标杆""影响深远""推动行业发展""具有重要意义"这类空泛吹捧，除非搜索结果直接给出可量化证据。
- 不要把歌词主题写成鸡汤。
- 不要插图。

来源策略：
- 中文歌优先用中文资料（网易云/QQ 音乐/Apple Music 页面、艺人访谈、唱片公司、豆瓣、维基、百度百科）；外文歌用对应原文资料。
- 优先官方/直接来源；二手来源（Wikipedia、Genius、乐评站）只采纳具体可核对的事实。
- 论坛/自媒体只能取硬信息，不采纳价值判断。

只输出短文本身，不要前言、不要"以下是为你写的短文"之类的开场白。`;

function userPrompt(args: {
  title: string;
  artist: string;
  platform: string;
  sourceUrl: string;
  album?: string;
}): string {
  const albumLine = args.album ? `（已知收录于专辑 ${args.album}）` : '';
  return `歌名：${args.title}
艺人：${args.artist}
来源平台：${args.platform}${albumLine}
原链接：${args.sourceUrl}

请主动联网检索这首歌的背景资料，按 system 指令写一篇有故事感的 Markdown 短文。`;
}

/* undici (node fetch) hides the real network failure inside err.cause.code
   — e.g. UND_ERR_SOCKET, ECONNRESET, EAI_AGAIN — and reports a generic
   "fetch failed" at the surface. This unpacks the cause so the client can
   see why instead of staring at a meaningless string. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const c = cause as { code?: string; message?: string };
    if (c.code || c.message) {
      return `${err.message} (${c.code ?? ''}${c.code && c.message ? ': ' : ''}${c.message ?? ''})`.trim();
    }
  }
  return err.message;
}

/* Cache compatibility: prior payload shapes used `article` / `identity` /
   `credits` etc.; the new prose shape is `{ hasData, content }`. Treat
   anything that doesn't match the new shape as a cache miss so old rows
   get regenerated on next view. */
function isCurrentPayloadShape(payload: unknown): payload is SongDnaPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as { hasData?: unknown; content?: unknown };
  if (p.hasData === false) return true;
  if (p.hasData === true && typeof p.content === 'string') return true;
  return false;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const title = params.get('title');
  const artist = params.get('artist');
  const platform = params.get('platform');
  const sourceUrl = params.get('sourceUrl');
  const album = params.get('album') ?? undefined;
  const refresh = params.get('refresh') === 'true';

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
          if (cached && isCurrentPayloadShape(cached.payload)) {
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

        // ─── LLM streaming call ─────────────────────────────
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          send({ kind: 'error', message: 'OPENROUTER_API_KEY not configured' });
          controller.close();
          return;
        }

        send({ kind: 'status', phase: 'started' });
        send({ kind: 'status', phase: 'searching', detail: '全网检索歌曲资料' });

        // No `response_format` — the model writes free-form markdown.
        // Forcing json_object was making deepseek + web_search hang or
        // return empty content; markdown lets it produce naturally.
        // max_tokens: 16000 covers ~7-8k Chinese chars — well beyond any
        // reasonable Song DNA essay; still keeps a hard ceiling so a
        // runaway model can't burn through token budget on one request.
        const requestBody = JSON.stringify({
          model: MODEL,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: userPrompt({ title, artist, platform, sourceUrl, album }),
            },
          ],
          tools: [WEB_SEARCH_TOOL],
          temperature: 0.3,
          max_tokens: 16000,
        });

        const callUpstream = () =>
          undiciFetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://ohmydna.com',
              'X-Title': 'MusiCard',
            },
            body: requestBody,
            dispatcher: openrouterAgent,
          });

        let upstream: Awaited<ReturnType<typeof callUpstream>>;
        try {
          upstream = await callUpstream();
        } catch (firstErr) {
          // First attempt failed at the network layer — openrouter sometimes
          // resets the connection while spinning up the web_search subprocess.
          // One retry after a short backoff almost always succeeds.
          send({
            kind: 'status',
            phase: 'searching',
            detail: `首次连接失败 (${describeError(firstErr)})，正在重试`,
          });
          await new Promise((r) => setTimeout(r, 600));
          upstream = await callUpstream();
        }

        if (!upstream.ok || !upstream.body) {
          const errBody = await upstream.text().catch(() => '');
          send({
            kind: 'error',
            message: `OpenRouter ${upstream.status}: ${errBody.slice(0, 200)}`,
          });
          controller.close();
          return;
        }

        // undici's ReadableStream<Uint8Array> generics don't line up with
        // DOM's TextDecoderStream, so we decode chunks ourselves.
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let contentAcc = '';
        let lastFinishReason: string | null = null;
        let lastPhase: 'started' | 'analyzing' | 'synthesizing' = 'started';
        const seenUrls = new Set<string>();

        outer: while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') break outer;
            let chunk: UpstreamChunk;
            try {
              chunk = JSON.parse(data) as UpstreamChunk;
            } catch {
              continue;
            }
            const choice = chunk.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta ?? {};

            // url_citation annotations = web_search hits flowing back from
            // OpenRouter's server tool. They arrive before any content. We
            // dedupe by URL so reused citations don't multiply the phase event.
            if (delta.annotations?.length) {
              for (const ann of delta.annotations) {
                const url = ann.url_citation?.url;
                if (url && !seenUrls.has(url)) seenUrls.add(url);
              }
              if (lastPhase !== 'analyzing') {
                lastPhase = 'analyzing';
              }
              send({
                kind: 'status',
                phase: 'analyzing',
                detail: `已读取 ${seenUrls.size} 个来源`,
              });
              continue;
            }

            // Free-form markdown content. We forward each delta to the
            // client so the essay streams in live, and accumulate the full
            // text for caching at the end.
            const contentPiece =
              typeof delta.content === 'string'
                ? delta.content
                : typeof choice.message?.content === 'string'
                  ? choice.message.content
                  : '';
            if (contentPiece.length > 0) {
              if (lastPhase !== 'synthesizing') {
                lastPhase = 'synthesizing';
                send({ kind: 'status', phase: 'synthesizing' });
              }
              contentAcc += contentPiece;
              send({ kind: 'chunk', text: contentPiece });
            }

            if (choice.finish_reason) {
              lastFinishReason = choice.finish_reason;
              break outer;
            }
          }
        }

        // ─── Wrap up: detect HASDATA:FALSE sentinel, otherwise treat
        //     accumulated text as the essay body. ──────────────
        let trimmed = contentAcc.trim();
        if (!trimmed) {
          send({
            kind: 'error',
            message: '模型返回了空内容，可能是上游临时故障，请稍后再试',
          });
          controller.close();
          return;
        }

        // If the model stopped because it hit max_tokens, append a visible
        // marker so the user knows the essay was clipped (and can refresh
        // for another attempt). Don't cache truncated content.
        const wasTruncated = lastFinishReason === 'length';
        if (wasTruncated) {
          trimmed += '\n\n---\n\n*（模型输出达到长度上限被截断，可点击「重新检索」再生成一次）*';
        }

        const payload: SongDnaPayload =
          /^HASDATA\s*:\s*FALSE\b/i.test(trimmed)
            ? { hasData: false }
            : { hasData: true, content: trimmed };

        if (!wasTruncated) {
          await setCachedSongDna(cacheKey, title, artist, payload, MODEL);
        }
        send({ kind: 'final', payload, cached: false });
        controller.close();
      } catch (err) {
        // Surface err.cause when available — node's undici hides the real
        // reason inside cause.code (UND_ERR_SOCKET / ECONNRESET / etc.),
        // and "fetch failed" alone is uselessly generic.
        send({
          kind: 'error',
          message: describeError(err),
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
