import { type NextRequest, NextResponse } from 'next/server';
import {
  listRefreshCandidates,
  updateCachedTrack,
  type CachedTrack,
  type RefreshCandidate,
} from '@/lib/db';
import {
  fetchSpotifyTrack,
  fetchAppleMusicTrack,
  bucketToHeader,
} from '@/lib/upstream';

const BATCH_LIMIT = 50;

export async function GET(request: NextRequest) {
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const candidates = await listRefreshCandidates(BATCH_LIMIT);
  let refreshed = 0;
  let failed = 0;

  for (const c of candidates) {
    try {
      const fresh = await refetch(c);
      if (fresh) {
        await updateCachedTrack(c.cacheKey, fresh);
        refreshed++;
      }
    } catch (err) {
      failed++;
      console.error(`[cron] refresh failed for ${c.cacheKey}:`, err);
    }
  }

  return NextResponse.json({
    candidates: candidates.length,
    refreshed,
    failed,
  });
}

async function refetch(c: RefreshCandidate): Promise<CachedTrack | null> {
  if (c.platform === 'spotify') {
    const upstream = await fetchSpotifyTrack(
      c.externalId,
      bucketToHeader(c.locale),
    );
    return {
      platform: 'spotify',
      externalId: c.externalId,
      country: null,
      ...upstream,
    };
  }
  if (c.country) {
    const upstream = await fetchAppleMusicTrack(c.externalId, c.country, '');
    return {
      platform: 'appleMusic',
      externalId: c.externalId,
      country: c.country,
      ...upstream,
    };
  }
  return null;
}
