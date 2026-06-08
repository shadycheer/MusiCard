import { type NextRequest, NextResponse } from 'next/server';
import {
  getCachedLyrics,
  setCachedLyrics,
  lyricsCacheKey,
  type LyricsSource,
} from '@/lib/db';
import { fetchLyricViaWeapi } from '@/lib/neteaseWeapi';
import { fetchQqLyrics } from '@/lib/upstream';

const LRCLIB_ENDPOINT = 'https://lrclib.net/api/get';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = (process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-pro').replace(
  /:online$/,
  '',
);
/* 8s rather than 4.5s — LRCLIB is hosted in EU and can take 3-6s
   for cold queries against rare track names. 4.5s was over-tripping
   the timeout and forcing every non-fast request into the slow AI
   fallback path. */
const LRCLIB_TIMEOUT_MS = 8000;

/* OpenRouter server-side web search — kicked on for the AI phase so the
   model can actually look songs up instead of having to rely on training
   memory. The cost overhead (~$0.05/call) is worth it because the AI
   phase only fires after both NetEase (if applicable) and LRCLIB have
   already missed — i.e. exactly the niche-track tail where training
   memory is unreliable. */
const WEB_SEARCH_TOOL = {
  type: 'openrouter:web_search',
  parameters: {
    engine: 'exa',
    max_results: 3,
    max_total_results: 5,
    search_context_size: 'low',
  },
};

type LrcLibResponse = {
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

type LyricsPayload = {
  lines: string[] | null;
  source: LyricsSource;
  error?: string;
};

/* GET /api/lyrics?title=&artist=
 *   - phase=lrclib (default): consult cache; if cache says lrclib/ai/ai-miss it
 *     is terminal; if 'lrclib-miss' or no cache, query LRCLIB. The response
 *     tells the client whether AI fallback is still pending.
 *   - phase=ai: only run the AI step. Client kicks this when phase=lrclib came
 *     back with source='lrclib-miss'. */
export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get('title');
  const artist = request.nextUrl.searchParams.get('artist');
  const neteaseId = request.nextUrl.searchParams.get('neteaseId') ?? undefined;
  const qqMid = request.nextUrl.searchParams.get('qqMid') ?? undefined;
  const phase = request.nextUrl.searchParams.get('phase') ?? 'lrclib';
  if (!title || !artist) {
    return NextResponse.json({ error: 'missing title or artist' }, { status: 400 });
  }

  const cacheKey = lyricsCacheKey(title, artist);
  const cached = await getCachedLyrics(cacheKey);

  if (phase === 'ai') {
    return handleAiPhase(cacheKey, title, artist, cached);
  }
  return handleLrclibPhase(cacheKey, title, artist, cached, neteaseId, qqMid);
}

async function handleLrclibPhase(
  cacheKey: string,
  title: string,
  artist: string,
  cached: { lines: string[]; source: LyricsSource } | null,
  neteaseId: string | undefined,
  qqMid: string | undefined,
): Promise<NextResponse<LyricsPayload | { error: string }>> {
  if (cached) {
    // Terminal cache outcomes — return immediately, never re-query.
    if (cached.source === 'netease') {
      return NextResponse.json({ lines: cached.lines, source: 'netease' });
    }
    if (cached.source === 'qq') {
      return NextResponse.json({ lines: cached.lines, source: 'qq' });
    }
    if (cached.source === 'lrclib') {
      return NextResponse.json({ lines: cached.lines, source: 'lrclib' });
    }
    if (cached.source === 'ai') {
      return NextResponse.json({ lines: cached.lines, source: 'ai' });
    }
    if (cached.source === 'ai-miss') {
      return NextResponse.json({ lines: null, source: 'ai-miss' });
    }
    // 'lrclib-miss' is non-terminal under the new flow — the client will fire
    // phase=ai next. Echo it back so the client knows to do so without us
    // re-hitting LRCLIB.
    return NextResponse.json({ lines: null, source: 'lrclib-miss' });
  }

  /* Platform-native lyrics first for NetEase / QQ — both expose direct
     lyric endpoints that are usually more reliable than LRCLIB for
     Chinese/Asian tracks. If we have the platform-specific ID, we ONLY
     use that source; on miss we fall through to AI without hitting
     LRCLIB at all. (LRCLIB is reserved for Spotify / Apple Music.) */
  if (neteaseId) {
    try {
      const lines = await fetchLyricViaWeapi(neteaseId);
      if (lines && lines.length > 0) {
        void setCachedLyrics(cacheKey, title, artist, lines, 'netease');
        return NextResponse.json({ lines, source: 'netease' });
      }
    } catch {
      // Swallow — fall through to lrclib-miss → AI.
    }
    void setCachedLyrics(cacheKey, title, artist, [], 'lrclib-miss');
    return NextResponse.json({ lines: null, source: 'lrclib-miss' });
  }
  if (qqMid) {
    try {
      const lines = await fetchQqLyrics(qqMid);
      if (lines && lines.length > 0) {
        void setCachedLyrics(cacheKey, title, artist, lines, 'qq');
        return NextResponse.json({ lines, source: 'qq' });
      }
    } catch {
      // Swallow — fall through to lrclib-miss → AI.
    }
    void setCachedLyrics(cacheKey, title, artist, [], 'lrclib-miss');
    return NextResponse.json({ lines: null, source: 'lrclib-miss' });
  }

  try {
    const url = `${LRCLIB_ENDPOINT}?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS) });

    if (res.status === 404) {
      void setCachedLyrics(cacheKey, title, artist, [], 'lrclib-miss');
      return NextResponse.json({ lines: null, source: 'lrclib-miss' });
    }
    if (!res.ok) {
      return NextResponse.json({
        lines: null,
        source: 'lrclib-miss',
        error: `LRCLIB returned ${res.status}`,
      });
    }

    const data = (await res.json()) as LrcLibResponse;
    const raw = data.plainLyrics?.trim();
    if (!raw) {
      void setCachedLyrics(cacheKey, title, artist, [], 'lrclib-miss');
      return NextResponse.json({ lines: null, source: 'lrclib-miss' });
    }

    const lines = parseLyricsRaw(raw);
    void setCachedLyrics(cacheKey, title, artist, lines, 'lrclib');
    return NextResponse.json({ lines, source: 'lrclib' });
  } catch (err) {
    return NextResponse.json({
      lines: null,
      source: 'lrclib-miss',
      error: err instanceof Error ? err.message : 'LRCLIB request failed',
    });
  }
}

async function handleAiPhase(
  cacheKey: string,
  title: string,
  artist: string,
  cached: { lines: string[]; source: LyricsSource } | null,
): Promise<NextResponse<LyricsPayload | { error: string }>> {
  // If something already cached an AI verdict between LRCLIB call and now,
  // honor it instead of paying for another LLM call.
  if (cached?.source === 'ai') {
    return NextResponse.json({ lines: cached.lines, source: 'ai' });
  }
  if (cached?.source === 'ai-miss') {
    return NextResponse.json({ lines: null, source: 'ai-miss' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY not configured' },
      { status: 500 },
    );
  }

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ohmydna.com',
        'X-Title': 'MusiCard',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: aiUserPrompt(title, artist) },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
        tools: [WEB_SEARCH_TOOL],
      }),
    });

    /* Transient OpenRouter failures (rate limits, 5xx, network blips)
       are NOT cached as 'ai-miss' — that would burn the verdict and
       deny later retries. We return 200 + source:'ai-miss' so the
       UI degrades gracefully (no broken 502 in the network tab), but
       the structured `error` field is preserved end-to-end:
       - logged via console.error here so it shows in the dev server
       - returned in the response body so the client can console.warn
       - visible to error monitoring (Sentry etc.) as a 200 with an
         error field, instead of being swallowed
       i.e. softer than 502, but still observable. */
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      const detail = `OpenRouter ${upstream.status}: ${body.slice(0, 200)}`;
      console.error(`[lyrics] AI fallback upstream failed — ${detail}`);
      return NextResponse.json({ lines: null, source: 'ai-miss', error: detail });
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[lyrics] AI fallback returned empty content');
      return NextResponse.json({
        lines: null,
        source: 'ai-miss',
        error: 'empty model response',
      });
    }

    /* Models frequently wrap JSON in markdown code fences (```json ... ```)
       or prepend a preamble like "Here's the result: { ... }" — even
       with response_format:json_object set, since OpenRouter forwards
       to providers that don't all honor it strictly. extractJsonObject
       handles both cases by stripping fences first, then falling back
       to the first {...} substring. */
    let parsed: { hasLyrics: true; lines: string[] } | { hasLyrics: false };
    try {
      parsed = JSON.parse(extractJsonObject(content));
    } catch {
      console.error(
        `[lyrics] AI fallback returned non-JSON content: ${content.slice(0, 200)}`,
      );
      return NextResponse.json({
        lines: null,
        source: 'ai-miss',
        error: 'model returned non-JSON content',
      });
    }

    if (!parsed.hasLyrics || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
      void setCachedLyrics(cacheKey, title, artist, [], 'ai-miss');
      return NextResponse.json({ lines: null, source: 'ai-miss' });
    }

    const lines = parsed.lines
      .map((l) => (typeof l === 'string' ? l.trim() : ''))
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      void setCachedLyrics(cacheKey, title, artist, [], 'ai-miss');
      return NextResponse.json({ lines: null, source: 'ai-miss' });
    }

    void setCachedLyrics(cacheKey, title, artist, lines, 'ai');
    return NextResponse.json({ lines, source: 'ai' });
  } catch (err) {
    // Network failure / timeout — soft-miss, but echo the cause so
    // the dev log + client console + monitoring all see what broke.
    const detail = err instanceof Error ? err.message : 'unknown network error';
    console.error(`[lyrics] AI fallback threw — ${detail}`);
    return NextResponse.json({ lines: null, source: 'ai-miss', error: detail });
  }
}

const AI_SYSTEM_PROMPT = `你的任务是查找这首歌真实存在的歌词。这些歌词会被显示给用户做分享卡 — 编造或猜的歌词会被发到聊天里造成实际尴尬。

可用工具：
- web_search：联网搜索"歌名 歌词" / "title lyrics"，优先去 Genius / AZLyrics / Musixmatch / 歌词类网站。冷门歌请务必先搜，不要靠记忆。

严格规则：
1. 只输出从训练记忆或 web_search 结果里看到的真实歌词，不许根据歌名/风格/艺人推测。
2. web_search 没找到可靠歌词来源就返回 {"hasLyrics": false}。宁缺勿编。
3. 不要补全不完整的句子；整句不确定就整段省略；整段不确定就 hasLyrics: false。
4. 不要把"听起来像副歌"的句子当成真歌词。
5. 完全找不到这首歌就返回 {"hasLyrics": false}。

输出格式（极其重要）：
- 只输出原始 JSON 对象本身，不要包裹在 markdown 代码块里（不要写 \`\`\`json）
- 不要在 JSON 之前或之后加任何说明文字、preamble 或后记
- 找到：{"hasLyrics": true, "lines": ["第一行", "第二行", ...]}
- 找不到：{"hasLyrics": false}

lines 规则：
- 按歌曲实际出现顺序排列
- 一行一条字符串，不带时间戳、不带 [Verse]/[Chorus] 标记
- 不附加翻译或注释
- 重复的副歌按真实重复次数照实列出`;

function aiUserPrompt(title: string, artist: string): string {
  return `歌名：${title}
艺人：${artist}

请按 system 规则返回 JSON。`;
}

/* Pulls a JSON object substring out of free-form model output.
   Handles three observed model behaviours:
   1. raw JSON: "{...}" — passthrough
   2. fenced JSON: "```json\n{...}\n```" — strip fences
   3. preamble + fenced or bare JSON: "Here's the result: {...}" —
      find first { and last } */
function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return text.slice(first, last + 1);
  return text.trim();
}

function parseLyricsRaw(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim(),
    )
    .filter((line) => line.length > 0);
}
