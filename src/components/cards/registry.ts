import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import type { Platform } from '@/lib/music/url';
import SpotifyCard from './spotify/SpotifyCard';
import AppleMusicCard from './apple-music/AppleMusicCard';
import NeteaseCard from './netease/NeteaseCard';
import QqMusicCard from './qq-music/QqMusicCard';

/* All four platform cards share the same prop shape — title, artist,
   cover, QR, optional lyrics — and forward a ref to the rendered root
   for canvas export. The registry enforces this contract: if we ever
   add a fifth platform whose card needs extra props, TypeScript breaks
   here and the dispatcher (ShareCard) can't compile, surfacing the
   incompatibility at the right boundary. */
export type CardProps = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  lyrics?: string[];
};

type CardComponent = ForwardRefExoticComponent<
  CardProps & RefAttributes<HTMLDivElement>
>;

export const cardComponents: Record<Platform, CardComponent> = {
  spotify: SpotifyCard,
  appleMusic: AppleMusicCard,
  netease: NeteaseCard,
  qqMusic: QqMusicCard,
};
