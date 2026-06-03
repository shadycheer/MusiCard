export type Platform = 'spotify' | 'appleMusic';

export type ParseResult =
  | {
      kind: 'ok';
      platform: Platform;
      canonicalUrl: string;
      cacheKey: string; // stable key for DB lookup
      externalId: string; // raw track id from platform
      country: string | null; // Apple Music only
    }
  | { kind: 'invalid' }
  | { kind: 'non-track'; type: string };

const SPOTIFY_TRACK_REGEX =
  /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})(?:\?.*)?$/;
const SPOTIFY_NON_TRACK_REGEX =
  /^https:\/\/open\.spotify\.com\/(?:intl-[a-z]+\/)?(album|playlist|episode|artist|show)\//;

export function parseMusicUrl(input: string): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { kind: 'invalid' };

  const spotifyTrack = parseSpotifyTrack(trimmed);
  if (spotifyTrack) {
    return {
      kind: 'ok',
      platform: 'spotify',
      canonicalUrl: spotifyTrack.canonicalUrl,
      cacheKey: `spotify:${spotifyTrack.trackId}`,
      externalId: spotifyTrack.trackId,
      country: null,
    };
  }

  const appleTrack = parseAppleMusicTrack(trimmed);
  if (appleTrack) {
    return {
      kind: 'ok',
      platform: 'appleMusic',
      canonicalUrl: appleTrack.canonicalUrl,
      cacheKey: `apple:${appleTrack.country}:${appleTrack.trackId}`,
      externalId: appleTrack.trackId,
      country: appleTrack.country,
    };
  }

  const spotifyNon = trimmed.match(SPOTIFY_NON_TRACK_REGEX);
  if (spotifyNon) return { kind: 'non-track', type: spotifyNon[1] };

  const appleNon = detectAppleMusicNonTrack(trimmed);
  if (appleNon) return { kind: 'non-track', type: appleNon };

  return { kind: 'invalid' };
}

function parseSpotifyTrack(
  url: string,
): { canonicalUrl: string; trackId: string } | null {
  const m = url.match(SPOTIFY_TRACK_REGEX);
  if (!m) return null;
  return {
    canonicalUrl: `https://open.spotify.com/track/${m[1]}`,
    trackId: m[1],
  };
}

function parseAppleMusicTrack(
  url: string,
): { canonicalUrl: string; trackId: string; country: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'music.apple.com') return null;

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 4) return null;
  const [country, kind, slug, id] = parts;
  if (!/^[a-z]{2}$/.test(country)) return null;
  if (!/^\d+$/.test(id)) return null;

  if (kind === 'album') {
    const trackId = parsed.searchParams.get('i');
    if (!trackId || !/^\d+$/.test(trackId)) return null;
    return {
      canonicalUrl: `https://music.apple.com/${country}/album/${slug}/${id}?i=${trackId}`,
      trackId,
      country,
    };
  }
  if (kind === 'song') {
    return {
      canonicalUrl: `https://music.apple.com/${country}/song/${slug}/${id}`,
      trackId: id,
      country,
    };
  }
  return null;
}

function detectAppleMusicNonTrack(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'music.apple.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const kind = parts[1];
  if (kind === 'album' && !parsed.searchParams.get('i')) return 'album';
  if (['playlist', 'artist', 'station', 'curator'].includes(kind)) return kind;
  return null;
}
