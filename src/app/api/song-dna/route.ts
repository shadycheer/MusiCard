import { type NextRequest, NextResponse } from 'next/server';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// DeepSeek V3 by default — strong Chinese knowledge, ~1/20 the cost of
// Claude Sonnet, and not region-locked (OpenRouter blocks anthropic/*
// models from China-mainland IPs even when called via OpenRouter itself).
// Override with OPENROUTER_MODEL env var when deploying to Vercel where
// region is no longer a constraint.
const MODEL = process.env.OPENROUTER_MODEL ?? 'deepseek/deepseek-chat';

const SYSTEM_PROMPT = `你是一位克制、考据严谨的音乐随笔作者，为分享卡片配写一段"歌曲背后的故事"。

规则（严格遵守）：
1. 只在你确信的事实上展开。不知道、不确定、可能是编造的，一律不写。
2. 如果你对这首歌的背景信息掌握不足以写出 2 句以上有意义的内容，直接返回 JSON: {"hasStory": false}。不要勉强编。
3. 有内容时返回 JSON: {"hasStory": true, "text": "<150-280字中文随笔>", "sources": ["维基百科" 或 "Genius" 或 "艺人专访" 等可信来源类型，不超过 3 个]}。
4. 文风：中文、克制、有人情味。不写营销话术。不写"这首歌广受好评"这种空话。讲真事：创作背景、灵感来源、原型故事、流派渊源、文化关联、有意思的轶事，任选 1-2 个角度即可。
5. 不要复述歌词。不要描述音乐性（BPM/和弦/编曲手法）。专注故事。
6. 用一个具体的事实/情境开头（比如年份、地点、人物、事件），不要用"这首歌..."开头。
7. 全程使用简体中文。不夹杂英文段落。
8. 严禁编造艺人姓名、年份、地点、合作者。不确定就归到 hasStory: false。`;

const USER_PROMPT_TEMPLATE = (title: string, artist: string) => `歌名：${title}
艺人：${artist}

请按 system 规则返回 JSON。`;

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

type SongDnaPayload =
  | { hasStory: true; text: string; sources?: string[] }
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
      text: parsed.text,
      sources: parsed.sources ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error' },
      { status: 500 },
    );
  }
}
