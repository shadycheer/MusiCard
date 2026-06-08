import { forwardRef } from 'react';
import styles from './QqMusicCard.module.css';
import { qqMusicLockup } from '../assets/icons';

type Props = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  lyrics?: string[];
};

/* QQ Music share card — deep forest green gradient, white type, brand-
   green accent on the lyric rail. Cover sits in a glossy rounded frame.
   Same 320px geometry as the other variants so the shelf preview and
   the exported PNG land at consistent sizes. */
const QqMusicCard = forwardRef<HTMLDivElement, Props>(
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
            dangerouslySetInnerHTML={{ __html: qqMusicLockup }}
            aria-label="QQ Music"
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

QqMusicCard.displayName = 'QqMusicCard';
export default QqMusicCard;
