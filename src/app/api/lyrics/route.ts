import { type NextRequest, NextResponse } from 'next/server';
import {
  getCachedLyrics,
  setCachedLyrics,
  lyricsCacheKey,
  type LyricsSource,
} from '@/lib/db';
import { fetchLyricViaWeapi } from '@/lib/neteaseWeapi';

const LRCLIB_ENDPOINT = 'https://lrclib.net/api/get';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = (process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-pro').replace(
  /:online$/,
  '',
);
const LRCLIB_TIMEOUT_MS = 4500;

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
  const phase = request.nextUrl.searchParams.get('phase') ?? 'lrclib';
  if (!title || !artist) {
    return NextResponse.json({ error: 'missing title or artist' }, { status: 400 });
  }

  const cacheKey = lyricsCacheKey(title, artist);
  const cached = await getCachedLyrics(cacheKey);

  if (phase === 'ai') {
    return handleAiPhase(cacheKey, title, artist, cached);
  }
  return handleLrclibPhase(cacheKey, title, artist, cached, neteaseId);
}

async function handleLrclibPhase(
  cacheKey: string,
  title: string,
  artist: string,
  cached: { lines: string[]; source: LyricsSource } | null,
  neteaseId: string | undefined,
): Promise<NextResponse<LyricsPayload | { error: string }>> {
  if (cached) {
    // Terminal cache outcomes — return immediately, never re-query.
    if (cached.source === 'netease') {
      return NextResponse.json({ lines: cached.lines, source: 'netease' });
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

  // NetEase native lyrics first — authoritative for Chinese/Asian tracks
  // that LRCLIB doesn't carry. We only attempt this when the URL the user
  // pasted was a NetEase link (we have the song id); for Spotify / Apple
  // we skip straight to LRCLIB.
  if (neteaseId) {
    try {
      const lines = await fetchLyricViaWeapi(neteaseId);
      if (lines && lines.length > 0) {
        void setCachedLyrics(cacheKey, title, artist, lines, 'netease');
        return NextResponse.json({ lines, source: 'netease' });
      }
    } catch {
      // Swallow — fall through to LRCLIB rather than failing the request.
    }
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

    let parsed: { hasLyrics: true; lines: string[] } | { hasLyrics: false };
    try {
      parsed = JSON.parse(content);
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

输出 JSON：
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

function parseLyricsRaw(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim(),
    )
    .filter((line) => line.length > 0);
}
