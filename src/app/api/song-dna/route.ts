import { type NextRequest, NextResponse } from 'next/server';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// DeepSeek V3 by default — strong Chinese knowledge, ~1/20 the cost of
// Claude Sonnet, and not region-locked (OpenRouter blocks anthropic/*
// models from China-mainland IPs even when called via OpenRouter itself).
// Override with OPENROUTER_MODEL env var when deploying to Vercel where
// region is no longer a constraint.
const MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-v4-pro';

const SYSTEM_PROMPT = `你是一位严谨的音乐资料考据者，为分享卡补充"歌曲背后的资料"。

任务（按这个顺序考据）：
1. 找出这首歌的创作者：作词 / 作曲 / 编曲 / 制作人（能确认的字段才填，否则留 null）
2. 挖掘创作背景：灵感来源、原型人物或事件、写作时的处境、艺人当时的状态
3. 如有，补充制作过程的细节：录音轶事、特殊器乐选择、采样来源、关键合作者

严格规则：
- 你是在**查资料**，不是在**写作品**。所有内容必须基于你已知的真实事实。
- 不要复述歌词。不要做音乐性技术分析（BPM/和弦/编曲手法）。
- 不确定的字段宁缺勿编。credits 没把握就设为 null。
- 如果你对这首歌的资料掌握不足以填出 credits 中任意一项 + 至少 80 字 story，返回 {"hasStory": false}。
- 全程简体中文，不夹杂英文段落。

返回 JSON，shape：
{
  "hasStory": true,
  "credits": {
    "lyrics": "作词人" | null,
    "composition": "作曲人" | null,
    "arrangement": "编曲人" | null,
    "production": "制作人" | null
  },
  "story": "100-260 字中文，讲创作背景与制作细节（按上面顺序 2、3）",
  "sources": ["维基百科" | "Genius" | "艺人专访" | "唱片内页" 等可靠来源类型，最多 3 个]
}

或：{"hasStory": false}`;

const USER_PROMPT_TEMPLATE = (title: string, artist: string) => `歌名：${title}
艺人：${artist}

请按 system 规则返回 JSON。`;

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

type Credits = {
  lyrics?: string | null;
  composition?: string | null;
  arrangement?: string | null;
  production?: string | null;
};

type SongDnaPayload =
  | { hasStory: true; credits?: Credits; story: string; sources?: string[] }
  | { hasStory: false };

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY not configured' },
      { status: 500 },
    );
  }

  const { title, artist } = (await request.json().catch(() => ({}))) as {
    title?: string;
    artist?: string;
  };
  if (!title || !artist) {
    return NextResponse.json({ error: 'title and artist required' }, { status: 400 });
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
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT_TEMPLATE(title, artist) },
        ],
        temperature: 0.3,
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

    const data = (await upstream.json()) as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: 'empty response from model' }, { status: 502 });
    }

    let parsed: SongDnaPayload;
    try {
      parsed = JSON.parse(content) as SongDnaPayload;
    } catch {
      return NextResponse.json(
        { error: 'model returned non-JSON content' },
        { status: 502 },
      );
    }

    if (!parsed.hasStory) {
      return NextResponse.json({ hasStory: false });
    }

    return NextResponse.json({
      hasStory: true,
      credits: parsed.credits ?? {},
      story: parsed.story,
      sources: parsed.sources ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    );
  }
}
