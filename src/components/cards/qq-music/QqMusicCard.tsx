import { forwardRef } from 'react';
import styles from './QqMusicCard.module.css';
import { qqMusicLockup } from '@/assets/icons';

type Props = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  lyrics?: string[];
};

/* QQ Music share card — mirrors the brand's "CD disc peeking out from
   behind the album cover" arrangement seen in their official player UI.
   Fixed light-grass surface (not cover-tinted) keeps the layout calm so
   the disc + sleeve metaphor reads cleanly. */
const QqMusicCard = forwardRef<HTMLDivElement, Props>(
  ({ title, artist, coverUrl, qrSvg, lyrics }, ref) => {
    const hasLyrics = lyrics && lyrics.length > 0;
    return (
      <div ref={ref} className={styles.card}>
        <div className={styles.coverStage}>
          {/* The disc sits behind the cover and pokes out on the right —
              the visual move QQ uses on its album views. Pure CSS gradient
              fakes the polished plastic + concentric grooves. */}
          <div className={styles.disc} aria-hidden>
            <div className={styles.discHub} />
          </div>
          <div className={styles.coverWrap}>
            <img
              src={coverUrl}
              alt=""
              className={styles.cover}
              crossOrigin="anonymous"
            />
          </div>
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
