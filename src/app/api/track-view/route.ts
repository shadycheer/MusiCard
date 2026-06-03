import { type NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { recordView, recordExport } from '@/lib/db';

export async function POST(request: NextRequest) {
  let body: { type?: string };
  try {
    body = (await request.json()) as { type?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const ipHash = hashIp(extractIp(request));

  if (body.type === 'view') {
    void recordView(ipHash);
  } else if (body.type === 'export') {
    void recordExport();
  } else {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

function extractIp(request: NextRequest): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip')?.trim() ?? null;
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const salt = process.env.IP_SALT;
  if (!salt) return null;
  return createHash('sha256').update(ip + salt).digest('hex');
}
