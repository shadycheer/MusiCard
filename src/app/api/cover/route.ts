import { type NextRequest, NextResponse } from 'next/server';

// Allowlist prevents the proxy from being abused as an open redirect.
const ALLOWED_HOSTS = new Set([
  'i.scdn.co',
  'mosaic.scdn.co',
  'image-cdn-ak.spotifycdn.com',
  'image-cdn-fa.spotifycdn.com',
  'is1-ssl.mzstatic.com',
  'is2-ssl.mzstatic.com',
  'is3-ssl.mzstatic.com',
  'is4-ssl.mzstatic.com',
  'is5-ssl.mzstatic.com',
  'a1.mzstatic.com',
  'a2.mzstatic.com',
  'a3.mzstatic.com',
  'a4.mzstatic.com',
  'a5.mzstatic.com',
]);

// NetEase image CDN uses pN.music.126.net where N varies — match by suffix.
function isAllowedHost(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  if (/^p\d+\.music\.126\.net$/.test(hostname)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url');
  if (!target) {
    return NextResponse.json({ error: 'missing url param' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'https only' }, { status: 400 });
  }
  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json(
      { error: `host not allowed: ${parsed.hostname}` },
      { status: 400 },
    );
  }

  const isNetEase = parsed.hostname.endsWith('.music.126.net');

  try {
    const upstream = await fetch(parsed.toString(), {
      cache: 'force-cache',
      // NetEase image CDN rejects requests with no/foreign Referer.
      headers: isNetEase ? { Referer: 'https://music.163.com/' } : undefined,
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream returned ${upstream.status}` },
        { status: upstream.status },
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
