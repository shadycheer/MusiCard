import type { Platform, ParseResult } from './musicUrl';
import type { Track } from './songlink';

/* URL-slug encoding of a track identity.

   Slugs are deterministic + reversible from platform + externalId
   (+ country for Apple Music), so we don't need a server-side
   mapping table just to navigate. Same song on Spotify and the same
   song on NetEase produce DIFFERENT slugs today — see TODO below
   for the cross-platform unification path. */

export type ParsedSlug = {
  platform: Platform;
  externalId: string;
  /* Apple Music only — required for the iTunes lookup endpoint. */
  country: string | null;
  /* Reconstructed canonical URL the existing fetch pipeline expects. */
  canonicalUrl: string;
};

/* TODO(cross-platform-unify): when we add Songlink integration, this
   becomes a DB lookup — slug → canonical_song_id → list of
   (platform, externalId) tuples — so /netease-22707008 and
   /spotify-XXX both resolve to the same canonical song with
   alternate-platform links visible. Today each platform is siloed. */

export function buildSlug(
  platform: Platform,
  externalId: string,
  country: string | null,
): string {
  if (platform === 'spotify') return `spotify-${externalId}`;
  if (platform === 'netease') return `netease-${externalId}`;
  if (platform === 'qqMusic') return `qq-${externalId}`;
  if (platform === 'appleMusic') {
    return `apple-${country ?? 'us'}-${externalId}`;
  }
  throw new Error(`Unknown platform: ${platform}`);
}

export function trackToSlug(t: Track): string | null {
  /* Spotify / NetEase: pull the id straight from the canonical URL.
     We don't store externalId on the Track type today, so we re-parse
     to stay decoupled from the DB schema. */
  if (t.platform === 'spotify') {
    const m = t.sourceUrl.match(/\/track\/([A-Za-z0-9]{22})/);
    return m ? `spotify-${m[1]}` : null;
  }
  if (t.platform === 'netease') {
    const m = t.sourceUrl.match(/\bid=(\d+)/);
    return m ? `netease-${m[1]}` : null;
  }
  if (t.platform === 'qqMusic') {
    const m = t.sourceUrl.match(/\/songDetail\/([A-Za-z0-9]+)/);
    return m ? `qq-${m[1]}` : null;
  }
  if (t.platform === 'appleMusic') {
    /* Apple URLs look like /{country}/album/{slug}/{albumId}?i={trackId}
       or /{country}/song/{slug}/{trackId}. */
    try {
      const url = new URL(t.sourceUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      const country = parts[0];
      if (!/^[a-z]{2}$/.test(country)) return null;
      const kind = parts[1];
      const trackId =
        kind === 'song'
          ? parts[3]
          : url.searchParams.get('i');
      if (!trackId || !/^\d+$/.test(trackId)) return null;
      return `apple-${country}-${trackId}`;
    } catch {
      return null;
    }
  }
  return null;
}

export function parseSlug(slug: string): ParsedSlug | null {
  if (slug.startsWith('spotify-')) {
    const id = slug.slice('spotify-'.length);
    if (!/^[A-Za-z0-9]{22}$/.test(id)) return null;
    return {
      platform: 'spotify',
      externalId: id,
      country: null,
      canonicalUrl: `https://open.spotify.com/track/${id}`,
    };
  }
  if (slug.startsWith('netease-')) {
    const id = slug.slice('netease-'.length);
    if (!/^\d+$/.test(id)) return null;
    return {
      platform: 'netease',
      externalId: id,
      country: null,
      canonicalUrl: `https://music.163.com/song?id=${id}`,
    };
  }
  if (slug.startsWith('qq-')) {
    const id = slug.slice('qq-'.length);
    if (!/^[A-Za-z0-9]+$/.test(id)) return null;
    return {
      platform: 'qqMusic',
      externalId: id,
      country: null,
      canonicalUrl: `https://y.qq.com/n/ryqq/songDetail/${id}`,
    };
  }
  if (slug.startsWith('apple-')) {
    /* apple-{country}-{id} — country is always 2 lowercase letters. */
    const m = slug.match(/^apple-([a-z]{2})-(\d+)$/);
    if (!m) return null;
    const [, country, id] = m;
    /* The reconstructed canonical URL omits the album/song slug
       segment (we don't know it from the slug alone). The Apple
       endpoint accepts id + country without it. */
    return {
      platform: 'appleMusic',
      externalId: id,
      country,
      /* Placeholder canonical — the Apple fetch path will use
         id + country directly, not the URL, so this never round-trips
         to iTunes. Kept here for downstream consistency. */
      canonicalUrl: `https://music.apple.com/${country}/song/_/${id}`,
    };
  }
  return null;
}

/* Convenience: given a parsed-url ParseResult, build the slug. */
export function parseResultToSlug(parsed: ParseResult): string | null {
  if (parsed.kind !== 'ok') return null;
  return buildSlug(parsed.platform, parsed.externalId, parsed.country);
}
