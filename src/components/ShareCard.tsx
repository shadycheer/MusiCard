import { forwardRef } from 'react';
import SpotifyCard from './SpotifyCard';
import AppleMusicCard from './AppleMusicCard';
import type { Platform } from '../lib/musicUrl';

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
    return <AppleMusicCard ref={ref} {...rest} />;
  },
);

ShareCard.displayName = 'ShareCard';
export default ShareCard;
