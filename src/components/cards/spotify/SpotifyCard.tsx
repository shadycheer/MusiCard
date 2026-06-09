import { forwardRef } from 'react';
import styles from './SpotifyCard.module.css';
import { spotifyLockup } from '@/assets/icons';

type Props = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  lyrics?: string[];
};

const SpotifyCard = forwardRef<HTMLDivElement, Props>(
  ({ title, artist, coverUrl, qrSvg, lyrics }, ref) => {
    const hasLyrics = lyrics && lyrics.length > 0;
    return (
      <div ref={ref} className={styles.card}>
        <div className={styles.coverWrap}>
          <img
            src={coverUrl}
            alt=""
            className={styles.cover}
            crossOrigin="anonymous"
          />
        </div>

        <div className={styles.info}>
          <h2 className={styles.title}>{title}</h2>
          <p className={styles.artist}>{artist}</p>
        </div>

        {hasLyrics && (
          <div className={styles.lyrics}>
            {lyrics.map((line, i) => (
              <p key={i} className={styles.lyricLine}>
                {line}
              </p>
            ))}
          </div>
        )}

        <div className={styles.foot}>
          <span
            className={styles.brandLockup}
            dangerouslySetInnerHTML={{ __html: spotifyLockup }}
            aria-label="Spotify"
          />
          <div
            className={styles.qr}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        </div>
      </div>
    );
  },
);

SpotifyCard.displayName = 'SpotifyCard';
export default SpotifyCard;
