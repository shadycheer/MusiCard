import { forwardRef } from 'react';
import SpotifyCard from './spotify/SpotifyCard';
import AppleMusicCard from './apple-music/AppleMusicCard';
import NeteaseCard from './netease/NeteaseCard';
import QqMusicCard from './qq-music/QqMusicCard';
import type { Platform } from '@/lib/music/url';

type Props = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  platform: Platform;
  lyrics?: string[];
};

const ShareCard = forwardRef<HTMLDivElement, Props>(
  ({ platform, ...rest }, ref) => {
    if (platform === 'spotify') return <SpotifyCard ref={ref} {...rest} />;
    if (platform === 'netease') return <NeteaseCard ref={ref} {...rest} />;
    if (platform === 'qqMusic') return <QqMusicCard ref={ref} {...rest} />;
    return <AppleMusicCard ref={ref} {...rest} />;
  },
);

ShareCard.displayName = 'ShareCard';
export default ShareCard;
