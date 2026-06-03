-- Migration 0002: add `locale` column to tracks.
-- Spotify cache rows are now bucketed per major language code (zh/ja/ko/en/...)
-- because Accept-Language gives different artist names per locale.
-- Cache key changed from "spotify:<id>" to "spotify:<locale>:<id>".

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS locale TEXT;

CREATE INDEX IF NOT EXISTS tracks_locale_idx ON tracks (locale)
  WHERE locale IS NOT NULL;

-- Old rows from before localization have English-only artist names AND a
-- stale cache key format. Easier to wipe than migrate.
DELETE FROM tracks WHERE platform = 'spotify';
