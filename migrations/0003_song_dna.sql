-- Music Card v3 — Song DNA cache table.
-- Run once in Neon SQL Editor. Re-runnable via IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS song_dna (
  cache_key   TEXT PRIMARY KEY,           -- "songdna:<lower(title)>|<lower(artist)>"
  title       TEXT NOT NULL,
  artist      TEXT NOT NULL,
  payload     JSONB NOT NULL,             -- full SongDnaPayload, including { hasData: false }
  has_data    BOOLEAN NOT NULL,           -- = payload->>'hasData', redundant for fast filtering
  model       TEXT NOT NULL,              -- 'deepseek/deepseek-v4-pro' — for selective refresh on model upgrade
  cached_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count   INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS song_dna_hit_count_idx ON song_dna (hit_count DESC);
CREATE INDEX IF NOT EXISTS song_dna_model_idx     ON song_dna (model);
