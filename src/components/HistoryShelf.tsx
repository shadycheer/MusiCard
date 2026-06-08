'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

type ShelfEntry =
  | { kind: 'single'; track: Track; sortKey: number }
  | {
      kind: 'album';
      key: string;
      albumName: string;
      artist: string;
      coverUrl: string;
      tracks: Track[];
      sortKey: number;
    };

const COLS = 4;

/* Trim + lowercase + collapse internal whitespace. Used to build a
   cross-platform album group key — same album on Spotify and on
   NetEase usually agrees on artist + album name with minor casing /
   whitespace differences, so a normalize pass merges them. */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/* Bucket tracks into single-track entries and multi-track album
   entries. Order preservation: each entry keeps the position of its
   FIRST appearance in the original (recency-sorted) list, so an
   album whose newest track was just visited still floats to the top. */
function groupByAlbum(tracks: Track[]): ShelfEntry[] {
  const albumBuckets = new Map<
    string,
    { albumName: string; artist: string; coverUrl: string; tracks: Track[]; firstIdx: number }
  >();
  const singleEntries: ShelfEntry[] = [];

  tracks.forEach((t, idx) => {
    if (!t.albumName || !t.artist) {
      singleEntries.push({ kind: 'single', track: t, sortKey: idx });
      return;
    }
    const key = `${normalize(t.artist)}|${normalize(t.albumName)}`;
    const existing = albumBuckets.get(key);
    if (existing) {
      existing.tracks.push(t);
    } else {
      albumBuckets.set(key, {
        albumName: t.albumName,
        artist: t.artist,
        coverUrl: t.coverUrl,
        tracks: [t],
        firstIdx: idx,
      });
    }
  });

  const entries: ShelfEntry[] = [];
  for (const [key, bucket] of albumBuckets) {
    if (bucket.tracks.length === 1) {
      /* Only one track from this album in history — render as a
         normal single card. No point showing "album of 1 song". */
      entries.push({
        kind: 'single',
        track: bucket.tracks[0],
        sortKey: bucket.firstIdx,
      });
    } else {
      entries.push({
        kind: 'album',
        key,
        albumName: bucket.albumName,
        artist: bucket.artist,
        coverUrl: bucket.coverUrl,
        tracks: bucket.tracks,
        sortKey: bucket.firstIdx,
      });
    }
  }
  for (const s of singleEntries) entries.push(s);
  return entries.sort((a, b) => a.sortKey - b.sortKey);
}

/* Multi-row recent grid with album collapse. Same-album tracks
   render as a single stacked card; clicking expands a popover that
   lists the individual songs. */
export default function HistoryShelf({ tracks, onPick, onRemove }: Props) {
  const [openAlbumKey, setOpenAlbumKey] = useState<string | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<DOMRect | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  /* Close popover on outside click + ESC, and reset when the user
     navigates away. Using a ref to the popover lets us avoid the
     click that opens it from also being treated as outside. */
  useEffect(() => {
    if (!openAlbumKey) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popoverRef.current && !popoverRef.current.contains(target)) {
        setOpenAlbumKey(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenAlbumKey(null);
    };
    /* Defer the click listener by one tick so the click that opened
       the popover doesn't immediately close it. */
    const t = window.setTimeout(() => {
      window.addEventListener('click', onClick);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [openAlbumKey]);

  const handleAlbumClick = useCallback(
    (entry: Extract<ShelfEntry, { kind: 'album' }>, anchorEl: HTMLElement) => {
      if (openAlbumKey === entry.key) {
        setOpenAlbumKey(null);
        return;
      }
      setPopoverAnchor(anchorEl.getBoundingClientRect());
      setOpenAlbumKey(entry.key);
    },
    [openAlbumKey],
  );

  const handleAlbumRemove = useCallback(
    (entry: Extract<ShelfEntry, { kind: 'album' }>) => {
      for (const t of entry.tracks) onRemove(t.sourceUrl);
    },
    [onRemove],
  );

  if (tracks.length === 0) return null;

  const entries = groupByAlbum(tracks);
  const rows: ShelfEntry[][] = [];
  for (let i = 0; i < entries.length; i += COLS) {
    rows.push(entries.slice(i, i + COLS));
  }

  const openAlbum =
    openAlbumKey != null
      ? entries.find(
          (e): e is Extract<ShelfEntry, { kind: 'album' }> =>
            e.kind === 'album' && e.key === openAlbumKey,
        )
      : null;

  return (
    <>
      <section className={styles.shelf} aria-label="最近浏览">
        <header className={styles.shelfHead}>
          <span className={styles.shelfLabel}>最近</span>
          <span className={styles.shelfCount}>{entries.length}</span>
        </header>
        {rows.map((row, rowIdx) => (
          <div className={styles.shelfRow} key={rowIdx}>
            {row.map((entry) =>
              entry.kind === 'single' ? (
                <SingleCard
                  key={entry.track.sourceUrl}
                  track={entry.track}
                  onPick={onPick}
                  onRemove={onRemove}
                />
              ) : (
                <AlbumCard
                  key={entry.key}
                  entry={entry}
                  open={openAlbumKey === entry.key}
                  onOpen={handleAlbumClick}
                  onRemove={handleAlbumRemove}
                />
              ),
            )}
          </div>
        ))}
      </section>

      {openAlbum && popoverAnchor && (
        <AlbumPopover
          ref={popoverRef}
          entry={openAlbum}
          anchor={popoverAnchor}
          onPick={(t) => {
            setOpenAlbumKey(null);
            onPick(t);
          }}
          onClose={() => setOpenAlbumKey(null)}
        />
      )}
    </>
  );
}

/* ─── Single-track card ───────────────────────────────────────────── */

function SingleCard({
  track,
  onPick,
  onRemove,
}: {
  track: Track;
  onPick: (track: Track) => void;
  onRemove: (sourceUrl: string) => void;
}) {
  return (
    <div className={styles.shelfCell}>
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
  );
}

/* ─── Album-collapsed card (N ≥ 2 tracks of same album) ──────────── */

function AlbumCard({
  entry,
  open,
  onOpen,
  onRemove,
}: {
  entry: Extract<ShelfEntry, { kind: 'album' }>;
  open: boolean;
  onOpen: (
    entry: Extract<ShelfEntry, { kind: 'album' }>,
    anchorEl: HTMLElement,
  ) => void;
  onRemove: (entry: Extract<ShelfEntry, { kind: 'album' }>) => void;
}) {
  return (
    <div className={`${styles.shelfCell} ${styles.shelfCellAlbum}`}>
      <button
        type="button"
        className={`${styles.shelfItem} ${open ? styles.shelfItemOpen : ''}`}
        onClick={(e) => onOpen(entry, e.currentTarget)}
        title={`${entry.albumName} — ${entry.artist} (${entry.tracks.length} 首)`}
        aria-expanded={open}
      >
        {/* Two stacked pseudo-cover layers behind the real cover sell
            the "this is a collection" feel without needing 3 different
            crops. The shelfCover sits on top. */}
        <span className={styles.shelfStackLayer} aria-hidden />
        <span className={`${styles.shelfStackLayer} ${styles.shelfStackLayer2}`} aria-hidden />
        <img
          src={proxyCoverUrl(entry.coverUrl)}
          alt={entry.albumName}
          className={styles.shelfCover}
          loading="lazy"
        />
        <span className={styles.shelfMeta}>
          <span className={styles.shelfTitle}>{entry.albumName}</span>
          <span className={styles.shelfArtist}>
            {entry.artist} · {entry.tracks.length} 首
          </span>
        </span>
      </button>
      <button
        type="button"
        className={styles.shelfRemove}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(entry);
        }}
        aria-label={`移除专辑 ${entry.albumName}`}
        title="移除整张"
      >
        ×
      </button>
    </div>
  );
}

/* ─── Popover: track list of an expanded album ───────────────────── */

const AlbumPopover = ({
  ref,
  entry,
  anchor,
  onPick,
  onClose,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  entry: Extract<ShelfEntry, { kind: 'album' }>;
  anchor: DOMRect;
  onPick: (track: Track) => void;
  onClose: () => void;
}) => {
  /* Position the popover directly below the album card. If it would
     overflow the right edge of the viewport, clamp it inward. */
  const POPOVER_WIDTH = 280;
  const GAP = 12;
  const vpW = typeof window !== 'undefined' ? window.innerWidth : 1440;
  let left = anchor.left;
  if (left + POPOVER_WIDTH > vpW - 16) left = vpW - POPOVER_WIDTH - 16;
  if (left < 16) left = 16;
  const top = anchor.bottom + GAP;

  return (
    <div
      ref={ref}
      className={styles.albumPopover}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${POPOVER_WIDTH}px`,
      }}
      role="dialog"
      aria-label={`${entry.albumName} 的歌曲列表`}
    >
      <header className={styles.popoverHead}>
        <div className={styles.popoverTitleBlock}>
          <span className={styles.popoverTitle}>{entry.albumName}</span>
          <span className={styles.popoverSubtitle}>
            {entry.artist} · {entry.tracks.length} 首
          </span>
        </div>
        <button
          type="button"
          className={styles.popoverClose}
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>
      </header>
      <ul className={styles.popoverList}>
        {entry.tracks.map((t) => (
          <li key={t.sourceUrl}>
            <button
              type="button"
              className={styles.popoverItem}
              onClick={() => onPick(t)}
            >
              <img
                src={proxyCoverUrl(t.coverUrl)}
                alt=""
                className={styles.popoverItemCover}
                loading="lazy"
                aria-hidden
              />
              <span className={styles.popoverItemTitle}>{t.title}</span>
              <span className={styles.popoverItemPlatform}>{t.platform}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
