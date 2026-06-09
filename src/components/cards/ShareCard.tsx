import { forwardRef } from 'react';
import type { Platform } from '@/lib/music/url';
import { cardComponents, type CardProps } from './registry';

type Props = CardProps & {
  platform: Platform;
};

const ShareCard = forwardRef<HTMLDivElement, Props>(
  ({ platform, ...rest }, ref) => {
    const Card = cardComponents[platform];
    return <Card ref={ref} {...rest} />;
  },
);

ShareCard.displayName = 'ShareCard';
export default ShareCard;
