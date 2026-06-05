import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import styles from './NeteaseCard.module.css';
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

const FALLBACK_PALETTE: ExtractedPalette = {
  primary: '#3a3a3a',
  secondary: '#1a1a1a',
};

const NeteaseCard = forwardRef<HTMLDivElement, Props>(
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
      ['--nt-primary' as string]: darken(palette.primary, 0.55),
      ['--nt-secondary' as string]: darken(palette.secondary, 0.75),
    };

    return (
      <div ref={ref} className={styles.card} style={cardStyle}>
        <div className={styles.vinylStage}>
          <div className={styles.vinylHalo} aria-hidden />
          <div className={styles.vinyl} aria-hidden>
            <div className={styles.vinylGrooves} />
            <div className={styles.vinylShine} />
            <div className={styles.label}>
              <img
                src={coverUrl}
                alt=""
                className={styles.cover}
                crossOrigin="anonymous"
              />
            </div>
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
          <img
            src="/netease-logo-dark.svg"
            alt="网易云音乐"
            className={styles.brandLogo}
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

NeteaseCard.displayName = 'NeteaseCard';
export default NeteaseCard;
