'use client';

import type { Track } from '@/lib/songlink';
import { proxyCoverUrl } from '@/lib/coverProxy';
import styles from './HistoryShelf.module.css';

type Props = {
  tracks: Track[];
  onPick: (sourceUrl: string) => void;
  onRemove: (sourceUrl: string) => void;
};

/* Horizontal vinyl-rail of the user's recent tracks. Sourced directly
   from trackCache (no separate history store) — see lib/trackCache for
   the storage shape. Only renders when at least one track exists so
   first-time visitors still see the clean centered-input landing. */
export default function HistoryShelf({ tracks, onPick, onRemove }: Props) {
  if (tracks.length === 0) return null;
  return (
    <section className={styles.shelf} aria-label="最近浏览">
      <header className={styles.shelfHead}>
        <span className={styles.shelfLabel}>最近</span>
        <span className={styles.shelfCount}>{tracks.length}</span>
      </header>
      <div className={styles.shelfRail}>
        {tracks.map((track) => (
          <div className={styles.shelfCell} key={track.sourceUrl}>
            <button
              type="button"
              className={styles.shelfItem}
              onClick={() => onPick(track.sourceUrl)}
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
      <div className={styles.shelfBoard} aria-hidden />
    </section>
  );
}
