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

/* `:online` suffix = OpenRouter's web search plugin (pre-search injects
   results into the prompt). We use this instead of the newer
   `tools:[{type:'openrouter:web_search'}]` server tool because DeepSeek V4
   Pro doesn't speak the standard OpenAI tool_calls protocol — it emits its
   internal DSML format as plain content, which never gets routed back to
   the server tool. `:online` sidesteps tool calling entirely. */
const MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-pro';
const MODEL_WITH_SEARCH = MODEL.endsWith(':online') ? MODEL : `${MODEL}:online`;
const HAS_DATA_FALSE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
    finish_reason?: string | null;
  }>;
};

const SYSTEM_PROMPT = `你是一位严谨的音乐资料考据员，为分享卡补充"这首歌的真实资料"。

工作上下文：用户的提示词上方/系统会自动注入这首歌的实时网络搜索结果（含 URL、页面标题、原文摘录）。你只能基于这些搜索结果作答，不许凭训练记忆补全。

四个维度都要考据：身份信息 / 创作团队 / 创作过程 / 影响与传承。搜索结果优先来自 Wikipedia、Genius、Pitchfork、官方艺人专访、权威乐评等高可信源。

引用纪律（最重要）：
- 每个事实字段必须挂至少 1 条 citation，否则整个字段省略不出现。
- 每段叙事段落必须挂至少 1 条 citation。citations 的 url 必须是搜索结果里真实出现过的 URL，不许构造或修改 URL。
- excerpt 必须是搜索结果中真实出现过的片段（逐字摘抄即可），用来让用户对比核实。
- 不允许使用"据报道""有传言""可能是"这种推测话术 — 拿不到可信来源就空着。

图片纪律：
- 只允许使用搜索结果中真实出现的图片 URL（特别是 Wikipedia 条目里的 infobox 图、Wikimedia Commons 链接）。
- 如果没有把握图片 URL 真实可访问，不要附图。
- 严禁构造形如 https://example.com/cover.jpg 的占位 URL。

输出格式：单个 JSON object，符合以下 schema：

{
  "hasData": true | false,
  "identity"?: { "album"?: Fact, "releaseDate"?: Fact, "label"?: Fact, "duration"?: Fact },
  "credits"?: { "lyrics"?: Fact, "composition"?: Fact, "arrangement"?: Fact, "production"?: Fact,
                "studio"?: Fact, "musicians"?: Fact<string[]>,
                "engineers"?: Fact<{mixing?, mastering?, recording?}> },
  "making"?: { "inspiration"?: Paragraph, "writing"?: Paragraph, "recording"?: Paragraph },
  "legacy"?: { "commercial"?: Paragraph, "awards"?: Fact<string[]>,
               "covers"?: Fact<Array<{artist, year?, note?}>>,
               "mediaUse"?: Fact<Array<{medium, title, year?}>>,
               "impact"?: Paragraph }
}

其中：
- Fact = { value: T, citations: Citation[] }
- Paragraph = { text: string, citations: Citation[], image?: { url, caption?, sourceUrl } }
- Citation = { url: string, title?: string, excerpt?: string }

维度找不到任何可信资料就整个维度省略；整首歌都查不到任何可信资料就返回 {"hasData": false}。
全程简体中文，不夹杂英文段落（外语原名除外，如人名/专辑名）。`;

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

请基于已注入的搜索结果，按 system 规则考据这首歌的资料，返回符合 schema 的 JSON。`;
}

/* Some models wrap their JSON response in ```json ... ``` markdown fences
   even when response_format: json_object is set. Strip them defensively. */
function stripJsonFence(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
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

        // ─── LLM streaming call ─────────────────────────────
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          send({ kind: 'error', message: 'OPENROUTER_API_KEY not configured' });
          controller.close();
          return;
        }

        send({ kind: 'status', phase: 'started' });

        const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://musi-card-two.vercel.app',
            'X-Title': 'MusiCard',
          },
          body: JSON.stringify({
            model: MODEL_WITH_SEARCH,
            stream: true,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: userPrompt({ title, artist, platform, sourceUrl, album }),
              },
            ],
            temperature: 0,
            max_tokens: 4000,
            response_format: { type: 'json_object' },
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const errBody = await upstream.text().catch(() => '');
          send({
            kind: 'error',
            message: `OpenRouter ${upstream.status}: ${errBody.slice(0, 200)}`,
          });
          controller.close();
          return;
        }

        const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        let contentAcc = '';
        let lastPhase: 'started' | 'analyzing' | 'synthesizing' = 'started';
        const seenUrls = new Set<string>();

        outer: while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
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

            // content delta = final JSON being produced
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              if (lastPhase !== 'synthesizing') {
                lastPhase = 'synthesizing';
                send({ kind: 'status', phase: 'synthesizing' });
              }
              contentAcc += delta.content;
            }

            if (choice.finish_reason) break outer;
          }
        }

        // ─── Parse accumulated JSON ─────────────────────────
        let payload: SongDnaPayload;
        try {
          payload = JSON.parse(stripJsonFence(contentAcc)) as SongDnaPayload;
        } catch {
          send({ kind: 'error', message: 'model returned non-JSON content' });
          controller.close();
          return;
        }

        if (typeof (payload as { hasData?: unknown }).hasData !== 'boolean') {
          send({ kind: 'error', message: 'malformed payload from model' });
          controller.close();
          return;
        }

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
