'use client';

import type { Track } from '@/lib/songlink';
import { proxyCoverUrl } from '@/lib/coverProxy';
import styles from './HistoryShelf.module.css';

type Props = {
  tracks: Track[];
  /** Passes the whole Track up so the parent can build the per-platform
   *  slug without re-parsing the URL. */
  onPick: (track: Track) => void;
  onRemove: (sourceUrl: string) => void;
};

const COLS = 4;

/* Multi-row recent grid. Sourced from trackCache (single storage —
   see lib/trackCache.getRecentTracks). Renders only as many rows as
   there are tracks for, so 3 entries occupies 1 row, not an awkward
   grid full of blanks. */
export default function HistoryShelf({ tracks, onPick, onRemove }: Props) {
  if (tracks.length === 0) return null;
  const rows: Track[][] = [];
  for (let i = 0; i < tracks.length; i += COLS) {
    rows.push(tracks.slice(i, i + COLS));
  }
  return (
    <section className={styles.shelf} aria-label="最近浏览">
      <header className={styles.shelfHead}>
        <span className={styles.shelfLabel}>最近</span>
        <span className={styles.shelfCount}>{tracks.length}</span>
      </header>
      {rows.map((row, rowIdx) => (
        <div className={styles.shelfRow} key={rowIdx}>
          {row.map((track) => (
            <div className={styles.shelfCell} key={track.sourceUrl}>
              <button
                type="button"
                className={styles.shelfItem}
                onClick={() => onPick(track)}
                title={`${track.title} — ${track.artist}`}
              >
                <img
                  src={proxyCoverUrl(track.coverUrl)}
                  alt={track.title}
                  className={styles.shelfCover}
                  loading="lazy"
                />
                <span className={styles.shelfMeta}>
                  <span className={styles.shelfTitle}>{track.title}</span>
                  <span className={styles.shelfArtist}>{track.artist}</span>
                </span>
              </button>
              <button
                type="button"
                className={styles.shelfRemove}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(track.sourceUrl);
                }}
                aria-label={`移除 ${track.title}`}
                title="移除"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
