import type { Platform } from './url';
import type { Track } from './songlink';

/* Single source of truth for everything that varies per platform.
   Used by the slug builder, the track-fetch dispatcher, the export
   filename, and any UI that needs a human label. Adding a new
   platform = adding one entry here + the corresponding API route +
   the card component.

   Lives in /lib so it can be imported from both the server (slug,
   API routes) and the client (SongView) without pulling React into
   server bundles. The UI-side card/skeleton mapping lives separately
   in components/cards/registry.ts. */

export type PlatformMeta = {
  /** Human-readable label shown in error messages. */
  label: string;
  /** Filename prefix for exported card PNGs
   *  (e.g., 'spotify-card-{title}.png'). */
  filePrefix: string;
  /** Backend API route segment under /api (e.g., 'spotify-track' for
   *  /api/spotify-track). */
  apiRoute: string;
  /** Build the query-string params for the platform's /api/*-track
   *  endpoint. Most platforms need only `id`; Apple Music also needs
   *  `country` and `source`. Returns null if the URL doesn't match
   *  the platform's shape. */
  apiQuery: (sourceUrl: string) => Record<string, string> | null;
  /** Extract the platform-native track id from a canonical URL.
   *  Returns null if the URL doesn't match the platform's shape. */
  trackIdFromUrl: (sourceUrl: string) => string | null;
  /** Build the slug segment from a Track. Apple Music needs the
   *  country code in addition to id; others are just `{prefix}-{id}`. */
  slugFromTrack: (track: Track) => string | null;
  /** Build a slug given raw (id, country) — used when the caller
   *  already parsed the canonical URL upstream. Country is only
   *  meaningful for Apple Music. */
  slugFromIds: (externalId: string, country: string | null) => string;
};

const spotifyIdFromUrl = (url: string): string | null =>
  url.match(/\/track\/([A-Za-z0-9]{22})/)?.[1] ?? null;

const neteaseIdFromUrl = (url: string): string | null =>
  url.match(/\bid=(\d+)/)?.[1] ?? null;

const qqIdFromUrl = (url: string): string | null =>
  url.match(/\/songDetail\/([A-Za-z0-9]+)/)?.[1] ?? null;

/* Apple URLs have two shapes: /{country}/album/{slug}/{albumId}?i={trackId}
   (track on an album) or /{country}/song/{slug}/{trackId} (standalone
   song). Both encode the country in path segment 0. */
function appleIdAndCountryFromUrl(
  url: string,
): { id: string; country: string } | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const country = parts[0];
    if (!country || !/^[a-z]{2}$/.test(country)) return null;
    const kind = parts[1];
    const id =
      kind === 'song' ? parts[3] : (u.searchParams.get('i') ?? undefined);
    if (!id || !/^\d+$/.test(id)) return null;
    return { id, country };
  } catch {
    return null;
  }
}

export const platforms: Record<Platform, PlatformMeta> = {
  spotify: {
    label: 'Spotify',
    filePrefix: 'spotify-card',
    apiRoute: 'spotify-track',
    apiQuery: (url) => {
      const id = spotifyIdFromUrl(url);
      return id ? { id } : null;
    },
    trackIdFromUrl: spotifyIdFromUrl,
    slugFromTrack: (t) => {
      const id = spotifyIdFromUrl(t.sourceUrl);
      return id ? `spotify-${id}` : null;
    },
    slugFromIds: (id) => `spotify-${id}`,
  },
  appleMusic: {
    label: 'Apple Music',
    filePrefix: 'apple-music-card',
    apiRoute: 'apple-music-track',
    /* Apple uniquely needs country + the original URL — the server-side
     *  route uses country for the iTunes lookup region and `source` to
     *  reconstruct the canonical link when iTunes returns abbreviated
     *  data. */
    apiQuery: (url) => {
      const parsed = appleIdAndCountryFromUrl(url);
      return parsed
        ? { id: parsed.id, country: parsed.country, source: url }
        : null;
    },
    trackIdFromUrl: (url) => appleIdAndCountryFromUrl(url)?.id ?? null,
    slugFromTrack: (t) => {
      const parsed = appleIdAndCountryFromUrl(t.sourceUrl);
      return parsed ? `apple-${parsed.country}-${parsed.id}` : null;
    },
    slugFromIds: (id, country) => `apple-${country ?? 'us'}-${id}`,
  },
  netease: {
    label: '网易云音乐',
    filePrefix: 'netease-card',
    apiRoute: 'netease-track',
    apiQuery: (url) => {
      const id = neteaseIdFromUrl(url);
      return id ? { id } : null;
    },
    trackIdFromUrl: neteaseIdFromUrl,
    slugFromTrack: (t) => {
      const id = neteaseIdFromUrl(t.sourceUrl);
      return id ? `netease-${id}` : null;
    },
    slugFromIds: (id) => `netease-${id}`,
  },
  qqMusic: {
    label: 'QQ 音乐',
    filePrefix: 'qq-music-card',
    apiRoute: 'qq-track',
    apiQuery: (url) => {
      const id = qqIdFromUrl(url);
      return id ? { id } : null;
    },
    trackIdFromUrl: qqIdFromUrl,
    slugFromTrack: (t) => {
      const id = qqIdFromUrl(t.sourceUrl);
      return id ? `qq-${id}` : null;
    },
    slugFromIds: (id) => `qq-${id}`,
  },
};
