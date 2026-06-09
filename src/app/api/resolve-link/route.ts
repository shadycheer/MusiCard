import { type NextRequest, NextResponse } from 'next/server';

/* Server-side short-link expander. Two known shapes:
   - 163cn.tv/{slug}                       → music.163.com/...
   - c6.y.qq.com/base/fcgi-bin/u?__=...    → i.y.qq.com/v8/playsong.html?songmid=...

   Browser-side fetch can't follow these reliably (CORS + some hosts
   reject HEAD), so the home input fans them through this endpoint
   before handing the resolved URL to parseMusicUrl. */

const ALLOWED_SHORT_HOSTS = new Set(['163cn.tv', 'c.y.qq.com', 'c6.y.qq.com']);

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url');
  if (!target) {
    return NextResponse.json({ error: 'missing url' }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  if (!ALLOWED_SHORT_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: 'host not in allowlist' }, { status: 400 });
  }

  /* QQ's c6.y.qq.com rejects HEAD with 500. iOS Safari UA gets us the
     real 302 to a playsong URL containing songmid. We only follow one
     hop (redirect: 'manual'): downstream redirects can chain into
     i2.y.qq.com but the first hop already carries the songmid in its
     Location header. */
  try {
    const res = await fetch(target, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      },
    });
    const location = res.headers.get('location');
    if (location) {
      return NextResponse.json({ resolved: location });
    }
    /* No Location header — either it 200ed directly (already final) or
       the hop returned an HTML interstitial. Echo back the request URL
       so the client falls back to its own parse attempt. */
    return NextResponse.json({ resolved: target });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
