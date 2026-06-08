import { type NextRequest, NextResponse } from 'next/server';
import {
  getCachedLyrics,
  setCachedLyrics,
  lyricsCacheKey,
  type LyricsSource,
} from '@/lib/db';

const LRCLIB_ENDPOINT = 'https://lrclib.net/api/get';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AI_MODEL = (process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-pro').replace(
  /:online$/,
  '',
);
const LRCLIB_TIMEOUT_MS = 4500;

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
  const phase = request.nextUrl.searchParams.get('phase') ?? 'lrclib';
  if (!title || !artist) {
    return NextResponse.json({ error: 'missing title or artist' }, { status: 400 });
  }

  const cacheKey = lyricsCacheKey(title, artist);
  const cached = await getCachedLyrics(cacheKey);

  if (phase === 'ai') {
    return handleAiPhase(cacheKey, title, artist, cached);
  }
  return handleLrclibPhase(cacheKey, title, artist, cached);
}

async function handleLrclibPhase(
  cacheKey: string,
  title: string,
  artist: string,
  cached: { lines: string[]; source: LyricsSource } | null,
): Promise<NextResponse<LyricsPayload | { error: string }>> {
  if (cached) {
    // Terminal cache outcomes — return immediately, never re-query.
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
        'HTTP-Referer': 'https://musi-card-two.vercel.app',
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
      }),
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      return NextResponse.json(
        { error: `OpenRouter ${upstream.status}: ${body.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = (await upstream.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: 'empty response from model' }, { status: 502 });
    }

    let parsed: { hasLyrics: true; lines: string[] } | { hasLyrics: false };
    try {
      parsed = JSON.parse(content);
    } catch {
      return NextResponse.json(
        { error: 'model returned non-JSON content' },
        { status: 502 },
      );
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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    );
  }
}

const AI_SYSTEM_PROMPT = `你的任务是查找这首歌真实存在的歌词。这些歌词会被显示给用户做分享卡 — 编造或猜的歌词会被发到聊天里造成实际尴尬。

严格规则：
1. 你只能基于你训练时见过的真实歌词作答。不许根据歌名、风格、艺人或常见套路推测歌词。
2. 不确定就返回 {"hasLyrics": false}。宁缺勿编。
3. 不要补全或改写不完整记忆中的句子。整句不确定就整段省略；整段不确定就 hasLyrics: false。
4. 不要把"听起来像副歌"的句子当成真歌词。
5. 完全不认识这首歌就返回 {"hasLyrics": false}。

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
