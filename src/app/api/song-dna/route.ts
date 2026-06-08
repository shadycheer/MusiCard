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
export const maxDuration = 90;

const MODEL = (
  process.env.OPENROUTER_SONG_DNA_MODEL ?? 'qwen/qwen3-max'
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

const SYSTEM_PROMPT = `你是一位音乐编辑和资料考据员，为分享卡补充"这首歌为什么值得分享"。

用户想要的不是百科条目，而是一篇短音乐文章：像音乐媒体写一首歌的故事，先提出一个有证据的钩子，再解释背景、转折、传播机制和为什么这首歌值得被再次播放。参考结构是：
1. 一个强钩子：例如非主打歌后来爆红、榜单长尾、广告/影视/婚礼/现场让它命运改变、某次创作背景足够动人。
2. 背景：艺人当时处境、专辑阶段、音乐场景或地区语境。
3. 机制：它如何被听见，为什么留下来。优先写具体数字、年份、使用场景、采访事实。
4. 结尾：给用户一个能用于分享的判断，不写空泛吹捧。

工作方式：你可以主动联网检索，也可以用你的音乐知识决定检索方向；但最终写进 JSON 的每个事实，都必须有真实 URL 引用支撑。不许凭记忆直接落笔。

来源策略：
- 不做固定来源白名单，不限制国家、语言或站点。中文歌优先检索中文歌名、艺人中文名、专辑名、网易云/QQ 音乐/Apple Music/Spotify 页面、唱片公司资料、采访、新闻、百科、乐评；外文歌也用对应原文资料。
- 优先直接来源：官方曲目信息、唱片公司/发行方、艺人访谈、专辑 booklet/liner notes、主流音乐资料库、可信媒体报道。
- 直接来源不足时，可以使用 Genius、Wikipedia、MusicBrainz、Discogs、豆瓣、百度百科、维基百科等二手资料，但只采纳能被片段支持的硬信息。
- 谨慎使用论坛/自媒体/SEO 乐评站：只能取具体可核对事实，比如编曲、乐手、录音细节、奖项；不要采纳它们的价值判断。
- 不要因为找不到 Pitchfork/Wikipedia 这类来源就判定没资料；只要有可核对的来源，就提取有用信息。

引用纪律（最重要）：
- 每个事实字段必须挂至少 1 条 citation，否则整个字段省略不出现。
- 每段叙事段落必须挂至少 1 条 citation。citations 的 url 必须是搜索结果里真实出现过的 URL，不许构造或修改 URL。
- excerpt 必须是搜索结果中真实出现过的片段（逐字摘抄即可），用来让用户对比核实。
- 不允许使用"据报道""有传言""可能是"这种推测话术 — 拿不到可信来源就空着。

内容取向：
- 用户不想看百科搬运，想看能帮助他分享这首歌的高信号信息：专辑/发行、作者/制作、一个真实创作背景、一个听感或编曲抓手、一个传播/奖项/时代位置。
- 新结果默认只输出 article。identity/credits/making/legacy 是旧版兜底字段：只有找不到文章钩子、但能找到基础资料时才输出；只要 article 能成立，就不要输出这些旧字段。
- 不要为了填满四个维度硬凑商业表现、奖项、翻唱、影视使用。没有强相关资料就留空。
- 输出像一篇短文：lead 1 段、keyFacts 3-5 条、sections 2-3 段、takeaway 1 段。每段 1-2 句，信息密度高一点。
- 最多发起 2 次搜索；拿到足够支撑 4-6 个有用信息点的资料后立刻停止检索并输出。
- 整个 JSON 尽量控制在 1300 个汉字以内。
- 禁止宏大空话：不要写"树立标杆""推动行业发展""广泛借鉴""影响深远"这类评价，除非来源片段直接给出具体证据。
- 禁止把歌词主题写成空泛鸡汤。要么有来源支持，要么不写。
- 优先写 making.inspiration / making.recording / credits / identity；legacy 只有在有强证据时才写。

图片纪律：
- 只允许使用搜索结果中真实出现的图片 URL（特别是 Wikipedia 条目里的 infobox 图、Wikimedia Commons 链接）。
- 如果没有把握图片 URL 真实可访问，不要附图。
- 严禁构造形如 https://example.com/cover.jpg 的占位 URL。

输出格式：单个 JSON object，符合以下 schema：

{
  "hasData": true | false,
  "article"?: {
    "headline": string,
    "lead": Paragraph,
    "keyFacts"?: Fact<string[]>,
    "sections": Array<{ "title": string, "body": Paragraph }>,
    "takeaway"?: Paragraph
  },
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

只要能写 article，就只返回 article，不要返回旧字段；如果只能找到平台基础信息，也可以只返回 identity/credits，不要硬写故事；整首歌都查不到任何可信资料就返回 {"hasData": false}。
全程简体中文，不夹杂英文段落（外语原名除外，如人名/专辑名）。headline 不要写成营销标题，直接写这首歌最值得讲的事实。`;

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

请主动检索，不要限制来源域名。优先找和这首歌直接相关、能解释"为什么值得分享"的资料，返回符合 schema 的 JSON。`;
}

/* Some models wrap their JSON response in ```json ... ``` markdown fences
   even when response_format: json_object is set. Strip them defensively. */
function stripJsonFence(s: string): string {
  const trimmed = s.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractJsonObject(s: string): string {
  const stripped = stripJsonFence(s);
  if (stripped.startsWith('{') && stripped.endsWith('}')) return stripped;

  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return stripped.slice(start, end + 1);
  }
  return stripped;
}

function cleanPayload(payload: SongDnaPayload): SongDnaPayload {
  if (!payload.hasData) return payload;

  if (payload.article) {
    return { hasData: true, article: payload.article };
  }

  const weakPraise =
    /树立标杆|推动.*发展|影响深远|广泛借鉴|提升.*水平|奠定.*地位|具有重要意义/;

  const keepParagraph = (p?: { text: string }): boolean =>
    !!p && !weakPraise.test(p.text);

  if (payload.legacy?.impact && !keepParagraph(payload.legacy.impact)) {
    delete payload.legacy.impact;
  }
  if (payload.legacy && Object.values(payload.legacy).every((v) => v == null)) {
    delete payload.legacy;
  }

  return payload;
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
        send({ kind: 'status', phase: 'searching', detail: '全网检索歌曲资料' });

        const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://musi-card-two.vercel.app',
            'X-Title': 'MusiCard',
          },
          body: JSON.stringify({
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
            temperature: 0,
            max_tokens: 1800,
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

            // Content = final JSON being produced. Most chat streams use
            // delta.content; some OpenRouter server-tool streams surface a
            // full message.content chunk near the end.
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
            }

            if (choice.finish_reason) break outer;
          }
        }

        // ─── Parse accumulated JSON ─────────────────────────
        let payload: SongDnaPayload;
        try {
          payload = JSON.parse(extractJsonObject(contentAcc)) as SongDnaPayload;
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

        payload = cleanPayload(payload);
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
