import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import styles from './AppleMusicCard.module.css';
import { appleMusicLockup } from '@/assets/icons';
import {
  extractCoverPalette,
  darken,
  type ExtractedPalette,
} from '@/lib/card/colorExtraction';

type Props = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  lyrics?: string[];
};

const FALLBACK_PALETTE: ExtractedPalette = {
  primary: '#4A4138',
  secondary: '#2A2520',
};

const AppleMusicCard = forwardRef<HTMLDivElement, Props>(
  ({ title, artist, coverUrl, qrSvg, lyrics }, ref) => {
    const hasLyrics = lyrics && lyrics.length > 0;
    const [palette, setPalette] = useState<ExtractedPalette>(FALLBACK_PALETTE);

    useEffect(() => {
      if (!coverUrl) return;
      let cancelled = false;
      extractCoverPalette(coverUrl).then((p) => {
        if (!cancelled) setPalette(p);
      });
      return () => {
        cancelled = true;
      };
    }, [coverUrl]);

    const cardStyle: CSSProperties = {
      ['--am-primary' as string]: palette.primary,
      ['--am-secondary' as string]: darken(palette.secondary, 0.25),
    };

    return (
      <div ref={ref} className={styles.card} style={cardStyle}>
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
            {lyrics.map((line, i) => {
              const isEdge =
                lyrics.length >= 3 && (i === 0 || i === lyrics.length - 1);
              return (
                <p
                  key={i}
                  className={`${styles.lyricLine} ${isEdge ? styles.lyricLineEdge : ''}`}
                >
                  {line}
                </p>
              );
            })}
          </div>
        )}

        <div className={styles.foot}>
          <span
            className={styles.brandLockup}
            dangerouslySetInnerHTML={{ __html: appleMusicLockup }}
            aria-label="Apple Music"
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

AppleMusicCard.displayName = 'AppleMusicCard';
export default AppleMusicCard;
