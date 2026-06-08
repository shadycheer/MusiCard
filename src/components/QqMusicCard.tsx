import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import styles from './QqMusicCard.module.css';
import { qqMusicLockup } from '../assets/icons';
import {
  extractCoverPalette,
  darken,
  type ExtractedPalette,
} from '../lib/colorExtraction';

type Props = {
  title: string;
  artist: string;
  coverUrl: string;
  qrSvg: string;
  lyrics?: string[];
};

/* Cover-tinted backdrop — same trick as NeteaseCard. The QQ brand glyph
   keeps its official yellow/green, but the surrounding card pulls a
   moody gradient out of the album art so each song lands somewhere
   between "all-white slab" and "one solid dark blob". */
const FALLBACK_PALETTE: ExtractedPalette = {
  primary: '#3a3a3a',
  secondary: '#1a1a1a',
};

const QqMusicCard = forwardRef<HTMLDivElement, Props>(
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

    /* darken(0.30/0.55) lands the gradient in editorial territory —
       saturated enough to read the cover's mood, dark enough that
       white type sits comfortably on top. */
    const cardStyle: CSSProperties = {
      ['--qq-primary' as string]: darken(palette.primary, 0.30),
      ['--qq-secondary' as string]: darken(palette.secondary, 0.55),
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
