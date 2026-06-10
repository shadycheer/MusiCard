import { type NextRequest, NextResponse } from 'next/server';
import {
  getCachedLyrics,
  setCachedLyrics,
  lyricsCacheKey,
  type LyricsSource,
} from '@/lib/storage/db';
import { fetchLyricViaWeapi, searchNeteaseSongId } from '@/lib/music/netease';
import { fetchQqLyrics } from '@/lib/music/upstream';

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

  /* Three authoritative lanes start in PARALLEL — all free APIs, so
     racing costs nothing (unlike the LRCLIB-vs-AI race this codebase
     removed). The old serial flow sent platform-native misses straight
     to the slow paid AI phase without ever asking LRCLIB, and never
     used NetEase's catalog for Spotify/Apple links at all.

       A. platform-native by id (NetEase weapi / QQ) — exact, original-
          language lyrics; highest trust.
       B. NetEase keyword search → lyric — covers CJK songs pasted as
          Spotify/Apple links; guarded by a strict title+artist match.
       C. LRCLIB — canonical for Western catalog.

     Preference: A, then B/C ordered by script (CJK queries trust the
     NetEase catalog first, Latin queries trust LRCLIB first). We await
     in priority order rather than Promise.race so a fast low-priority
     hit can't beat a slower better source. */
  const nativeP: Promise<LaneOutcome> = (async () => {
    try {
      if (neteaseId) {
        const lines = await fetchLyricViaWeapi(neteaseId);
        if (lines && lines.length > 0) return { kind: 'hit', lines, source: 'netease' };
        return { kind: 'miss' };
      }
      if (qqMid) {
        const lines = await fetchQqLyrics(qqMid);
        if (lines && lines.length > 0) return { kind: 'hit', lines, source: 'qq' };
        return { kind: 'miss' };
      }
      return { kind: 'miss' };
    } catch (err) {
      return { kind: 'error', detail: err instanceof Error ? err.message : 'native lyrics failed' };
    }
  })();

  const searchP: Promise<LaneOutcome> = (async () => {
    /* Redundant when we already hold a NetEase id — lane A asks the
       same catalog with an exact key. */
    if (neteaseId) return { kind: 'miss' };
    try {
      const id = await searchNeteaseSongId(title, artist);
      if (!id) return { kind: 'miss' };
      const lines = await fetchLyricViaWeapi(id);
      if (lines && lines.length > 0) return { kind: 'hit', lines, source: 'netease' };
      return { kind: 'miss' };
    } catch (err) {
      return { kind: 'error', detail: err instanceof Error ? err.message : 'netease search failed' };
    }
  })();

  const lrclibP: Promise<LaneOutcome> = (async () => {
    /* LRCLIB indexes by exact track name, so "Imagine" matches but
       "飞机场的10:30 (Live)" doesn't even though the studio version
       is in the library as "飞机场的10:30". Query the original and the
       suffix-stripped title in parallel; prefer the original on a
       double hit. */
    const candidates = [title, stripVersionSuffix(title)].filter(
      (t, i, arr) => t && arr.indexOf(t) === i,
    );
    const settled = await Promise.allSettled(
      candidates.map(async (candidate) => {
        const url = `${LRCLIB_ENDPOINT}?track_name=${encodeURIComponent(candidate)}&artist_name=${encodeURIComponent(artist)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(LRCLIB_TIMEOUT_MS) });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`LRCLIB returned ${res.status}`);
        const data = (await res.json()) as LrcLibResponse;
        return data.plainLyrics?.trim() || null;
      }),
    );
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value) {
        return { kind: 'hit', lines: parseLyricsRaw(s.value), source: 'lrclib' };
      }
    }
    const failed = settled.find((s) => s.status === 'rejected');
    if (failed) {
      return {
        kind: 'error',
        detail: failed.reason instanceof Error ? failed.reason.message : 'LRCLIB request failed',
      };
    }
    return { kind: 'miss' };
  })();

  // Kana / Han / Hangul — decides which catalog to trust first.
  const queryHasCjk = /[぀-ヿ㐀-鿿가-힯]/.test(
    `${title}${artist}`,
  );
  const ordered = queryHasCjk
    ? [nativeP, searchP, lrclibP]
    : [nativeP, lrclibP, searchP];

  const outcomes: LaneOutcome[] = [];
  for (const laneP of ordered) {
    const outcome = await laneP;
    if (outcome.kind === 'hit') {
      void setCachedLyrics(cacheKey, title, artist, outcome.lines, outcome.source);
      return NextResponse.json({ lines: outcome.lines, source: outcome.source });
    }
    outcomes.push(outcome);
  }

  /* All lanes missed. Only cache the miss when every lane answered
     cleanly — a transient lane failure must stay retryable instead of
     pinning this song onto the AI path forever. */
  const transient = outcomes.find(
    (o): o is Extract<LaneOutcome, { kind: 'error' }> => o.kind === 'error',
  );
  if (transient) {
    return NextResponse.json({
      lines: null,
      source: 'lrclib-miss',
      error: transient.detail,
    });
  }
  void setCachedLyrics(cacheKey, title, artist, [], 'lrclib-miss');
  return NextResponse.json({ lines: null, source: 'lrclib-miss' });
}

type LaneOutcome =
  | { kind: 'hit'; lines: string[]; source: 'netease' | 'qq' | 'lrclib' }
  | { kind: 'miss' }
  | { kind: 'error'; detail: string };

async function handleAiPhase(
  cacheKey: string,
  title: string,
  artist: string,
  cached: { lines: string[]; source: LyricsSource } | null,
): Promise<NextResponse<LyricsPayload | { error: string }>> {
  /* ANY terminal verdict that landed since the client kicked this phase
     wins — including authoritative lrclib/netease/qq hits. The old code
     only short-circuited on ai/ai-miss, so an AI phase racing a
     successful LRCLIB phase would run the LLM anyway and overwrite the
     real lyrics with AI ones (the "song flips to AI badge on revisit"
     bug). 'lrclib-miss' is the only non-terminal state. */
  if (cached && cached.source !== 'lrclib-miss') {
    if (cached.source === 'ai-miss') {
      return NextResponse.json({ lines: null, source: 'ai-miss' });
    }
    return NextResponse.json({ lines: cached.lines, source: cached.source });
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
      await cacheAiOutcome(cacheKey, title, artist, [], 'ai-miss');
      return NextResponse.json({ lines: null, source: 'ai-miss' });
    }

    const lines = parsed.lines
      .map((l) => (typeof l === 'string' ? l.trim() : ''))
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      await cacheAiOutcome(cacheKey, title, artist, [], 'ai-miss');
      return NextResponse.json({ lines: null, source: 'ai-miss' });
    }

    await cacheAiOutcome(cacheKey, title, artist, lines, 'ai');
    return NextResponse.json({ lines, source: 'ai' });
  } catch (err) {
    // Network failure / timeout — soft-miss, but echo the cause so
    // the dev log + client console + monitoring all see what broke.
    const detail = err instanceof Error ? err.message : 'unknown network error';
    console.error(`[lyrics] AI fallback threw — ${detail}`);
    return NextResponse.json({ lines: null, source: 'ai-miss', error: detail });
  }
}

/* Guarded cache write for the AI phase. The LLM call takes 10s+; an
   authoritative source (lrclib/netease/qq) may have written its verdict
   while we waited. Re-read right before writing and yield to anything
   terminal — last-write-wins here was how AI lyrics silently replaced
   real ones. Only an empty slot or a non-terminal 'lrclib-miss' may be
   claimed by the AI verdict. */
async function cacheAiOutcome(
  cacheKey: string,
  title: string,
  artist: string,
  lines: string[],
  source: 'ai' | 'ai-miss',
): Promise<void> {
  const latest = await getCachedLyrics(cacheKey);
  if (latest && latest.source !== 'lrclib-miss') return;
  void setCachedLyrics(cacheKey, title, artist, lines, source);
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

/* Strip common version markers from a track title so a "(Live)" /
   "(Remastered 2011)" / "(Acoustic)" track can match the studio
   version's LRCLIB entry as a fallback. Returns the cleaned title;
   if nothing was stripped, returns the original. */
function stripVersionSuffix(title: string): string {
  const cleaned = title
    .replace(/\s*[\(\[（【][^\)\]）】]*(?:Live|Remix|Remaster(?:ed)?|Acoustic|Demo|Edit|Version|Mix|Mono|Stereo|现场|原版|纯音乐)[^\)\]）】]*[\)\]）】]\s*/gi, ' ')
    .replace(/\s+-\s+(?:Live|Remix|Remaster(?:ed)?|Acoustic|Demo|Edit|Version|Mix|Mono|Stereo)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title;
}

function parseLyricsRaw(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line.replace(/^\s*\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*/, '').trim(),
    )
    .filter((line) => line.length > 0);
}
