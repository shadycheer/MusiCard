import type { Platform, ParseResult } from './url';
import type { Track } from './songlink';
import { platforms } from './platforms';

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
  return platforms[platform].slugFromIds(externalId, country);
}

export function trackToSlug(t: Track): string | null {
  return platforms[t.platform].slugFromTrack(t);
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
