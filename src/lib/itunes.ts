import type { Track } from './songlink';

export async function fetchAppleMusicTrack(
  canonicalUrl: string,
  signal?: AbortSignal,
): Promise<Track> {
  const url = new URL(canonicalUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  const country = parts[0];
  const trackId = url.searchParams.get('i') ?? parts[3];
  if (!trackId || !/^\d+$/.test(trackId)) {
    throw new Error('链接里找不到曲目 ID');
  }
  if (!country || !/^[a-z]{2}$/.test(country)) {
    throw new Error('链接里找不到地区代码');
  }

  const proxyUrl = `/api/apple-music-track?id=${trackId}&country=${country}&source=${encodeURIComponent(canonicalUrl)}`;
  const res = await fetch(proxyUrl, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `查询失败 (${res.status})`);
  }
  const data = (await res.json()) as {
    title: string;
    artist: string;
    coverUrl: string;
    sourceUrl: string;
    albumId?: string | null;
    albumName?: string | null;
  };

  return {
    title: data.title,
    artist: data.artist,
    coverUrl: data.coverUrl,
    sourceUrl: data.sourceUrl || canonicalUrl,
    platform: 'appleMusic',
    albumId: data.albumId ?? undefined,
    albumName: data.albumName ?? undefined,
  };
}
