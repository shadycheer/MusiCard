# Music Card

Generates platform-themed share cards for Spotify and Apple Music tracks. Paste a link, optionally pick a few lyric lines, download a PNG.

## Stack

- Next.js 16 (App Router)
- TypeScript
- `@neondatabase/serverless` for cache + analytics on Neon Postgres
- `next/font` self-hosting Manrope (Spotify) and Inter (Apple Music)
- Canvas API for pixel-perfect PNG export

## Local development

```bash
cp .env.local.example .env.local
# Fill in SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, DATABASE_URL, IP_SALT

npm install
node scripts/migrate.mjs   # one-time, creates tables in Neon
npm run dev
```

Open http://localhost:3000 and paste a Spotify or Apple Music track link.

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | yes | Spotify Web API client credentials |
| `SPOTIFY_CLIENT_SECRET` | yes | Spotify Web API client credentials |
| `DATABASE_URL` | optional | Neon Postgres pooled connection. If unset, app skips cache layer |
| `IP_SALT` | optional | Random string for hashing visitor IPs. If unset, UV dedup is skipped |

## Architecture

```
client (localStorage 7-day cache)
  ↓
/api/spotify-track  →  Neon (cached?)  →  Spotify Web API
/api/apple-music-track →  Neon (cached?)  →  iTunes Lookup
/api/lyrics  →  Neon (cached?)  →  LRCLIB
/api/cover?url=...  →  proxied + Cache-Control: immutable
/api/track-view  →  daily_stats + daily_visitors (IP-hashed UV)
```

Cover images proxy through `/api/cover` so the app works behind networks that block Spotify CDN.

## Deploy

Pushes to `main` deploy automatically on Vercel. Set the four env vars in the Vercel dashboard before the first deploy.
