-- Music Card v1 schema. Run once in Neon SQL Editor.
-- Re-runnable via IF NOT EXISTS guards.

-- ─── 1. Track metadata cache ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracks (
  cache_key      TEXT PRIMARY KEY,            -- "spotify:<locale>:<id>" | "apple:<country>:<id>"
  platform       TEXT NOT NULL,               -- 'spotify' | 'appleMusic'
  external_id    TEXT NOT NULL,               -- raw track id from platform
  country        TEXT,                        -- only set for Apple Music (iTunes store country)
  locale         TEXT,                        -- only set for Spotify (major language tag: zh/ja/ko/en/...)
  title          TEXT NOT NULL,
  artist         TEXT NOT NULL,
  cover_url      TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  cached_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_refreshed TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count      INTEGER NOT NULL DEFAULT 0,
  last_hit_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tracks_hit_count_idx ON tracks (hit_count DESC);
CREATE INDEX IF NOT EXISTS tracks_last_hit_idx  ON tracks (last_hit_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS tracks_platform_idx  ON tracks (platform);
CREATE INDEX IF NOT EXISTS tracks_locale_idx    ON tracks (locale) WHERE locale IS NOT NULL;

-- ─── 2. Lyrics cache ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lyrics (
  cache_key TEXT PRIMARY KEY,                 -- "lyrics:<lower(title)>|<lower(artist)>"
  title     TEXT NOT NULL,
  artist    TEXT NOT NULL,
  lines     TEXT[] NOT NULL,                  -- empty array for any 'miss' source
  source    TEXT NOT NULL,                    -- 'lrclib' | 'lrclib-miss' | 'ai' | 'ai-miss'
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 3. Daily aggregate stats ───────────────────────────────────────────
-- One row per day. Cron rolls daily_visitors into this nightly.
CREATE TABLE IF NOT EXISTS daily_stats (
  date            DATE PRIMARY KEY,
  page_views      BIGINT NOT NULL DEFAULT 0,
  exports         BIGINT NOT NULL DEFAULT 0,
  unique_visitors INTEGER NOT NULL DEFAULT 0
);

-- ─── 4. Per-day visitor dedup (pruned daily, never grows large) ─────────
CREATE TABLE IF NOT EXISTS daily_visitors (
  date    DATE NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (date, ip_hash)
);

CREATE INDEX IF NOT EXISTS daily_visitors_date_idx ON daily_visitors (date);
