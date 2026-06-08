import { type NextRequest, NextResponse } from 'next/server';
import {
  listAlbumBackfillCandidates,
  updateCachedTrack,
  type CachedTrack,
  type RefreshCandidate,
} from '@/lib/db';
import {
  fetchSpotifyTrack,
  fetchAppleMusicTrack,
  fetchNeteaseTrack,
  bucketToHeader,
} from '@/lib/upstream';

/* One-shot DB backfill for pre-2026-06-09 rows whose album_name is NULL.
   Idempotent — re-running picks up where it left off. Trigger manually:
     curl -H "Authorization: Bearer $CRON_SECRET" \
          https://ohmydna.com/api/cron/backfill-album
   Or schedule via Vercel cron until the candidate count hits zero. */

const BATCH_LIMIT = 50;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const candidates = await listAlbumBackfillCandidates(BATCH_LIMIT);
  let updated = 0;
  let failed = 0;
  let skipped = 0;

  for (const c of candidates) {
    try {
      const fresh = await refetch(c);
      if (!fresh) {
        skipped++;
        continue;
      }
      await updateCachedTrack(c.cacheKey, fresh);
      updated++;
    } catch (err) {
      failed++;
      console.error(`[cron] backfill-album failed for ${c.cacheKey}:`, err);
    }
  }

  return NextResponse.json({
    candidates: candidates.length,
    updated,
    failed,
    skipped,
    remaining: candidates.length === BATCH_LIMIT ? 'more — run again' : 'done',
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
  if (c.platform === 'netease') {
    const upstream = await fetchNeteaseTrack(c.externalId);
    return {
      platform: 'netease',
      externalId: c.externalId,
      country: null,
      ...upstream,
    };
  }
  if (c.platform === 'appleMusic' && c.country) {
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
