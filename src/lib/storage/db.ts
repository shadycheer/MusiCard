import { neon } from '@neondatabase/serverless';
import type { Platform } from '@/lib/music/url';
import type { SongDnaPayload } from '@/lib/song-dna/types';

// All helpers fail open: missing DATABASE_URL or query errors return null/skip.
// The app degrades to direct upstream calls, never crashes on DB issues.
const connectionString = process.env.DATABASE_URL;
const sql = connectionString ? neon(connectionString) : null;

export type CachedTrack = {
  platform: Platform;
  externalId: string;
  country: string | null;
  locale: string | null;
  title: string;
  artist: string;
  coverUrl: string;
  sourceUrl: string;
  /* Optional — NetEase singles sometimes have no album entry. The shelf
     groups by (artist + albumName) only when both are present. */
  albumId?: string | null;
  albumName?: string | null;
};

export async function getCachedTrack(
  cacheKey: string,
): Promise<CachedTrack | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT platform, external_id, country, locale, title, artist, cover_url, source_url, album_id, album_name
      FROM tracks
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `) as Array<{
      platform: Platform;
      external_id: string;
      country: string | null;
      locale: string | null;
      title: string;
      artist: string;
      cover_url: string;
      source_url: string;
      album_id: string | null;
      album_name: string | null;
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
      locale: row.locale,
      title: row.title,
      artist: row.artist,
      coverUrl: row.cover_url,
      sourceUrl: row.source_url,
      albumId: row.album_id,
      albumName: row.album_name,
    };
  } catch (err) {
    console.error('[db] getCachedTrack failed:', err);
    return null;
  }
}

export type RefreshCandidate = {
  cacheKey: string;
  platform: Platform;
  externalId: string;
  country: string | null;
  locale: string | null;
};

/** Picks tracks that were popular recently but haven't been refreshed in a while.
 *  Cron consumes this to keep hot data fresh without re-fetching cold rows. */
export async function listRefreshCandidates(limit: number): Promise<RefreshCandidate[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT cache_key, platform, external_id, country, locale
      FROM tracks
      WHERE last_hit_at > NOW() - INTERVAL '14 days'
        AND last_refreshed < NOW() - INTERVAL '7 days'
      ORDER BY hit_count DESC
      LIMIT ${limit}
    `) as Array<{
      cache_key: string;
      platform: Platform;
      external_id: string;
      country: string | null;
      locale: string | null;
    }>;
    return rows.map((r) => ({
      cacheKey: r.cache_key,
      platform: r.platform,
      externalId: r.external_id,
      country: r.country,
      locale: r.locale,
    }));
  } catch (err) {
    console.error('[db] listRefreshCandidates failed:', err);
    return [];
  }
}

/** Update metadata for an existing cached track without touching hit_count.
 *  Used by the cron refresher — the row was already counted when first cached. */
export async function updateCachedTrack(
  cacheKey: string,
  track: CachedTrack,
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE tracks SET
        title = ${track.title},
        artist = ${track.artist},
        cover_url = ${track.coverUrl},
        source_url = ${track.sourceUrl},
        locale = ${track.locale},
        album_id = ${track.albumId ?? null},
        album_name = ${track.albumName ?? null},
        last_refreshed = NOW()
      WHERE cache_key = ${cacheKey}
    `;
  } catch (err) {
    console.error('[db] updateCachedTrack failed:', err);
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
        (cache_key, platform, external_id, country, locale, title, artist, cover_url, source_url, album_id, album_name, hit_count, last_hit_at)
      VALUES
        (${cacheKey}, ${track.platform}, ${track.externalId}, ${track.country},
         ${track.locale}, ${track.title}, ${track.artist}, ${track.coverUrl},
         ${track.sourceUrl}, ${track.albumId ?? null}, ${track.albumName ?? null}, 1, NOW())
      ON CONFLICT (cache_key) DO UPDATE SET
        title = EXCLUDED.title,
        artist = EXCLUDED.artist,
        cover_url = EXCLUDED.cover_url,
        source_url = EXCLUDED.source_url,
        locale = EXCLUDED.locale,
        album_id = EXCLUDED.album_id,
        album_name = EXCLUDED.album_name,
        last_refreshed = NOW(),
        hit_count = tracks.hit_count + 1,
        last_hit_at = NOW()
    `;
  } catch (err) {
    console.error('[db] setCachedTrack failed:', err);
  }
}

export type LyricsSource =
  | 'lrclib'
  | 'lrclib-miss'
  | 'ai'
  | 'ai-miss'
  | 'netease'
  | 'qq';

export type CachedLyrics = {
  lines: string[];
  source: LyricsSource;
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
    `) as Array<{ lines: string[]; source: LyricsSource }>;
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
  source: LyricsSource,
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

// ─── Song DNA cache ────────────────────────────────────────────────────

export type CachedSongDna = {
  payload: SongDnaPayload;
  model: string;
  cachedAt: string;      // ISO timestamp
};

export function songDnaCacheKey(title: string, artist: string): string {
  return `songdna:${title.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
}

export async function getCachedSongDna(
  cacheKey: string,
): Promise<CachedSongDna | null> {
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT payload, model, cached_at
      FROM song_dna
      WHERE cache_key = ${cacheKey}
      LIMIT 1
    `) as Array<{ payload: SongDnaPayload; model: string; cached_at: string }>;
    const row = rows[0];
    if (!row) return null;
    return {
      payload: row.payload,
      model: row.model,
      cachedAt: row.cached_at,
    };
  } catch (err) {
    console.error('[db] getCachedSongDna failed:', err);
    return null;
  }
}

export async function setCachedSongDna(
  cacheKey: string,
  title: string,
  artist: string,
  payload: SongDnaPayload,
  model: string,
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO song_dna (cache_key, title, artist, payload, has_data, model, hit_count, last_hit_at)
      VALUES (${cacheKey}, ${title}, ${artist}, ${JSON.stringify(payload)}, ${payload.hasData}, ${model}, 1, NOW())
      ON CONFLICT (cache_key) DO UPDATE SET
        payload = EXCLUDED.payload,
        has_data = EXCLUDED.has_data,
        model = EXCLUDED.model,
        cached_at = NOW(),
        hit_count = song_dna.hit_count + 1,
        last_hit_at = NOW()
    `;
  } catch (err) {
    console.error('[db] setCachedSongDna failed:', err);
  }
}

export async function incrementSongDnaHit(cacheKey: string): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      UPDATE song_dna
      SET hit_count = hit_count + 1, last_hit_at = NOW()
      WHERE cache_key = ${cacheKey}
    `;
  } catch (err) {
    console.error('[db] incrementSongDnaHit failed:', err);
  }
}
