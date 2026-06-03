import { neon } from '@neondatabase/serverless';
import type { Platform } from './musicUrl';

// All helpers fail open: missing DATABASE_URL or query errors return null/skip.
// The app degrades to direct upstream calls, never crashes on DB issues.
const connectionString = process.env.DATABASE_URL;
const sql = connectionString ? neon(connectionString) : null;

export type CachedTrack = {
  platform: Platform;
  externalId: string;
  country: string | null;
  title: string;
  artist: string;
  coverUrl: string;
  sourceUrl: string;
};

export async function getCachedTrack(
  cacheKey: string,
): Promise<CachedTrack | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT platform, external_id, country, title, artist, cover_url, source_url
      FROM tracks
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `) as Array<{
      platform: Platform;
      external_id: string;
      country: string | null;
      title: string;
      artist: string;
      cover_url: string;
      source_url: string;
    }>;
    const row = rows[0];
    if (!row) return null;
    void sql`
      UPDATE tracks SET hit_count = hit_count + 1, last_hit_at = NOW()
      WHERE cache_key = ${cacheKey}
    `.catch(() => {});
    return {
      platform: row.platform,
      externalId: row.external_id,
      country: row.country,
      title: row.title,
      artist: row.artist,
      coverUrl: row.cover_url,
      sourceUrl: row.source_url,
    };
  } catch (err) {
    console.error('[db] getCachedTrack failed:', err);
    return null;
  }
}

export async function setCachedTrack(
  cacheKey: string,
  track: CachedTrack,
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO tracks
        (cache_key, platform, external_id, country, title, artist, cover_url, source_url, hit_count, last_hit_at)
      VALUES
        (${cacheKey}, ${track.platform}, ${track.externalId}, ${track.country},
         ${track.title}, ${track.artist}, ${track.coverUrl}, ${track.sourceUrl},
         1, NOW())
      ON CONFLICT (cache_key) DO UPDATE SET
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        cover_url = EXCLUDED.cover_url,
        source_url = EXCLUDED.source_url,
        last_refreshed = NOW(),
        hit_count = tracks.hit_count + 1,
        last_hit_at = NOW()
    `;
  } catch (err) {
    console.error('[db] setCachedTrack failed:', err);
  }
}

export type CachedLyrics = {
  lines: string[];
  source: 'lrclib' | 'lrclib-miss';
};

export function lyricsCacheKey(title: string, artist: string): string {
  return `lyrics:${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
}

export async function getCachedLyrics(
  cacheKey: string,
): Promise<CachedLyrics | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT lines, source FROM lyrics WHERE cache_key = ${cacheKey} LIMIT 1
    `) as Array<{ lines: string[]; source: 'lrclib' | 'lrclib-miss' }>;
    const row = rows[0];
    if (!row) return null;
    return { lines: row.lines, source: row.source };
  } catch (err) {
    console.error('[db] getCachedLyrics failed:', err);
    return null;
  }
}

export async function setCachedLyrics(
  cacheKey: string,
  title: string,
  artist: string,
  lines: string[],
  source: 'lrclib' | 'lrclib-miss',
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO lyrics (cache_key, title, artist, lines, source)
      VALUES (${cacheKey}, ${title}, ${artist}, ${lines}, ${source})
      ON CONFLICT (cache_key) DO UPDATE SET
        lines = EXCLUDED.lines,
        source = EXCLUDED.source,
        cached_at = NOW()
    `;
  } catch (err) {
    console.error('[db] setCachedLyrics failed:', err);
  }
}

export async function recordView(ipHash: string | null): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO daily_stats (date, page_views)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET page_views = daily_stats.page_views + 1
    `;
    if (ipHash) {
      const result = (await sql`
        INSERT INTO daily_visitors (date, ip_hash)
        VALUES (CURRENT_DATE, ${ipHash})
        ON CONFLICT DO NOTHING
        RETURNING ip_hash
      `) as Array<{ ip_hash: string }>;
      if (result.length > 0) {
        await sql`
          UPDATE daily_stats SET unique_visitors = unique_visitors + 1
          WHERE date = CURRENT_DATE
        `;
      }
    }
  } catch (err) {
    console.error('[db] recordView failed:', err);
  }
}

export async function recordExport(): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO daily_stats (date, exports)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET exports = daily_stats.exports + 1
    `;
  } catch (err) {
    console.error('[db] recordExport failed:', err);
  }
}
