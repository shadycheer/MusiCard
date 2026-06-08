export type Platform = 'spotify' | 'appleMusic' | 'netease' | 'qqMusic';

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

// NetEase share URL shapes — hash route (desktop), query route (mobile),
// /m/song path (mobile web), and 163cn.tv short links (WeChat sharing).
const NETEASE_TRACK_REGEXES: RegExp[] = [
  /^https?:\/\/music\.163\.com\/(?:#\/)?song\?[^ ]*\bid=(\d+)/,
  /^https?:\/\/music\.163\.com\/song\/(\d+)(?:\/|\?|$)/,
  /^https?:\/\/y\.music\.163\.com\/m\/song\?[^ ]*\bid=(\d+)/,
];
const NETEASE_NON_TRACK_REGEX =
  /^https?:\/\/music\.163\.com\/(?:#\/)?(album|playlist|artist|mv|dj|djradio|user)(?:\/|\?)/;

// QQ Music share shapes — desktop songDetail page (uses songmid), mobile
// playsong page (i.y.qq.com from app share, uses either songmid string or
// songid numeric depending on which share button was used). The fetcher
// figures out which API parameter to send based on the id format.
const QQ_TRACK_REGEXES: RegExp[] = [
  /^https?:\/\/y\.qq\.com\/n\/ryqq\/songDetail\/([A-Za-z0-9]+)(?:\?|$)/,
  /^https?:\/\/i\.y\.qq\.com\/v8\/playsong\.html\?[^ ]*\bsongmid=([A-Za-z0-9]+)/,
  /^https?:\/\/i\.y\.qq\.com\/v8\/playsong\.html\?[^ ]*\bsongid=(\d+)/,
];
const QQ_NON_TRACK_REGEX =
  /^https?:\/\/y\.qq\.com\/n\/ryqq\/(albumDetail|playlist|playsquare|singer|mv)\//;

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

  const neteaseTrack = parseNeteaseTrack(trimmed);
  if (neteaseTrack) {
    return {
      kind: 'ok',
      platform: 'netease',
      canonicalUrl: neteaseTrack.canonicalUrl,
      cacheKey: `netease:${neteaseTrack.trackId}`,
      externalId: neteaseTrack.trackId,
      country: null,
    };
  }
  const neteaseNon = trimmed.match(NETEASE_NON_TRACK_REGEX);
  if (neteaseNon) return { kind: 'non-track', type: neteaseNon[1] };

  const qqTrack = parseQqTrack(trimmed);
  if (qqTrack) {
    return {
      kind: 'ok',
      platform: 'qqMusic',
      canonicalUrl: qqTrack.canonicalUrl,
      cacheKey: `qq:${qqTrack.trackId}`,
      externalId: qqTrack.trackId,
      country: null,
    };
  }
  const qqNon = trimmed.match(QQ_NON_TRACK_REGEX);
  if (qqNon) return { kind: 'non-track', type: qqNon[1] };

  return { kind: 'invalid' };
}

function parseQqTrack(
  url: string,
): { canonicalUrl: string; trackId: string } | null {
  for (const re of QQ_TRACK_REGEXES) {
    const m = url.match(re);
    if (m) {
      return {
        canonicalUrl: `https://y.qq.com/n/ryqq/songDetail/${m[1]}`,
        trackId: m[1],
      };
    }
  }
  return null;
}

function parseNeteaseTrack(
  url: string,
): { canonicalUrl: string; trackId: string } | null {
  for (const re of NETEASE_TRACK_REGEXES) {
    const m = url.match(re);
    if (m) {
      return {
        canonicalUrl: `https://music.163.com/song?id=${m[1]}`,
        trackId: m[1],
      };
    }
  }
  return null;
}

/** Resolve a 163cn.tv short link by following the redirect. NetEase share
 *  sheet emits these for WeChat — they 302 to a normal music.163.com URL. */
export async function resolveNeteaseShortLink(url: string): Promise<string | null> {
  if (!/^https?:\/\/163cn\.tv\//.test(url)) return null;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return res.url || null;
  } catch {
    return null;
  }
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
