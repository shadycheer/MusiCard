'use client';

import type { HistoryEntry } from '@/hooks/useTrackHistory';
import { proxyCoverUrl } from '@/lib/coverProxy';
import styles from './HistoryShelf.module.css';

type Props = {
  history: HistoryEntry[];
  onPick: (sourceUrl: string) => void;
  onRemove: (sourceUrl: string) => void;
};

/* Vinyl-shelf homecoming for repeat visitors — a 3×3 grid of past
   covers below the input. Each cover is a clickable "vinyl record"
   that pre-fills the input + triggers a fetch when clicked. The
   shelf only renders when history exists, so first-time visitors
   still get the clean centered-input landing. */
export default function HistoryShelf({ history, onPick, onRemove }: Props) {
  if (history.length === 0) return null;
  return (
    <section className={styles.shelf} aria-label="最近浏览">
      <header className={styles.shelfHead}>
        <span className={styles.shelfLabel}>最近</span>
        <span className={styles.shelfCount}>{history.length}</span>
      </header>
      <div className={styles.shelfGrid}>
        {history.map((entry) => (
          <div className={styles.shelfCell} key={entry.sourceUrl}>
            <button
              type="button"
              className={styles.shelfItem}
              onClick={() => onPick(entry.sourceUrl)}
              title={`${entry.title} — ${entry.artist}`}
            >
              <img
                src={proxyCoverUrl(entry.coverUrl)}
                alt={entry.title}
                className={styles.shelfCover}
                loading="lazy"
              />
              <span className={styles.shelfMeta}>
                <span className={styles.shelfTitle}>{entry.title}</span>
                <span className={styles.shelfArtist}>{entry.artist}</span>
              </span>
            </button>
            <button
              type="button"
              className={styles.shelfRemove}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(entry.sourceUrl);
              }}
              aria-label={`移除 ${entry.title}`}
              title="移除"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
