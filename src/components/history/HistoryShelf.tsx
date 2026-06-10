'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { Track } from '@/lib/music/songlink';
import { proxyCoverUrl } from '@/lib/card/coverProxy';
import { extractCoverPalette } from '@/lib/card/colorExtraction';
import styles from './HistoryShelf.module.css';

/* Parse #rrggbb into channel ints. Feeds the --shadow-tint-* CSS vars
   so each cover's drop shadow picks up its own dominant color — the
   one trick that gives the grid "presence" without adding any frame
   or shelf chrome. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '');
  if (m.length !== 6) return null;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

/* Extract the cover's dominant color from the already-rendered <img>
   (no double-fetch, the bytes are cached). Falls back to neutral
   black shadow if CORS/canvas/etc. blocks the read. */
function useShadowTint() {
  const imgRef = useRef<HTMLImageElement>(null);
  const [tint, setTint] = useState<{ r: number; g: number; b: number } | null>(
    null,
  );

  const extract = useCallback(() => {
    const img = imgRef.current;
    if (!img || img.naturalWidth === 0) return;
    extractCoverPalette(img)
      .then((palette) => {
        const rgb = hexToRgb(palette.primary);
        if (rgb) setTint(rgb);
      })
      .catch(() => {});
  }, []);

  /* When the image is cached, React may attach the ref AFTER the load
     event fires — onLoad would never trigger. This catches that case. */
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) extract();
  }, [extract]);

  return { imgRef, tint, onLoad: extract };
}

function cellStyle(
  idx: number,
  tint: { r: number; g: number; b: number } | null,
): CSSProperties {
  const base: Record<string, string | number> = { '--idx': idx };
  if (tint) {
    base['--shadow-tint-r'] = tint.r;
    base['--shadow-tint-g'] = tint.g;
    base['--shadow-tint-b'] = tint.b;
  }
  return base as CSSProperties;
}

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

/* Row chunking must agree with the CSS grid column count, or a row
   wraps short on narrow viewports and the shelf hairlines land in
   the wrong place. Keep these queries in sync with the breakpoints
   in HistoryShelf.module.css (5 desktop / 4 ≤1024px / 3 ≤540px).
   The shelf never SSRs (parent mounts it from a useEffect-populated
   list), so reading matchMedia in the initializer is safe. */
function currentShelfCols(): number {
  if (window.matchMedia('(max-width: 540px)').matches) return 3;
  if (window.matchMedia('(max-width: 1024px)').matches) return 4;
  return 5;
}

function useShelfCols(): number {
  const [cols, setCols] = useState(() =>
    typeof window !== 'undefined' ? currentShelfCols() : 5,
  );
  useEffect(() => {
    const queries = ['(max-width: 540px)', '(max-width: 1024px)'].map((q) =>
      window.matchMedia(q),
    );
    const update = () => setCols(currentShelfCols());
    for (const mq of queries) mq.addEventListener('change', update);
    return () => {
      for (const mq of queries) mq.removeEventListener('change', update);
    };
  }, []);
  return cols;
}

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

/* Multi-row recent grid with album collapse. Same-album tracks render
   as a stacked card; clicking opens a centered "vinyl record" dialog
   that lists the individual songs.

   Previous version used an anchored popover that positioned itself
   under the clicked card via getBoundingClientRect — at viewport
   edges it ran off-screen and clipped its content. The centered
   dialog sidesteps that entirely. */
export default function HistoryShelf({ tracks, onPick, onRemove }: Props) {
  const cols = useShelfCols();
  const [openAlbumKey, setOpenAlbumKey] = useState<string | null>(null);

  /* ESC closes the dialog. Backdrop click is handled by the backdrop
     element's own onClick — no need for a document-wide listener. */
  useEffect(() => {
    if (!openAlbumKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenAlbumKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openAlbumKey]);

  const handleAlbumClick = useCallback(
    (entry: Extract<ShelfEntry, { kind: 'album' }>) => {
      setOpenAlbumKey((prev) => (prev === entry.key ? null : entry.key));
    },
    [],
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
  for (let i = 0; i < entries.length; i += cols) {
    rows.push(entries.slice(i, i + cols));
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
          {/* entries.length counts shelf cards (albums collapse N songs
              into one), so the unit is 张, not 首 — a 2-song album is
              one 张 but two 首. */}
          <span className={styles.shelfCount}>{entries.length} 张</span>
        </header>
        {rows.map((row, rowIdx) => (
          <div className={styles.shelfRow} key={rowIdx}>
            {row.map((entry, colIdx) => {
              const idx = rowIdx * cols + colIdx;
              return entry.kind === 'single' ? (
                <SingleCard
                  key={entry.track.sourceUrl}
                  track={entry.track}
                  idx={idx}
                  onPick={onPick}
                  onRemove={onRemove}
                />
              ) : (
                <AlbumCard
                  key={entry.key}
                  entry={entry}
                  idx={idx}
                  open={openAlbumKey === entry.key}
                  onOpen={handleAlbumClick}
                  onRemove={handleAlbumRemove}
                />
              );
            })}
          </div>
        ))}
      </section>

      {openAlbum && (
        <AlbumDialog
          entry={openAlbum}
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
  idx,
  onPick,
  onRemove,
}: {
  track: Track;
  idx: number;
  onPick: (track: Track) => void;
  onRemove: (sourceUrl: string) => void;
}) {
  const { imgRef, tint, onLoad } = useShadowTint();
  return (
    <div className={styles.shelfCell} style={cellStyle(idx, tint)}>
      <button
        type="button"
        className={styles.shelfItem}
        onClick={() => onPick(track)}
        title={`${track.title} — ${track.artist}`}
      >
        <img
          ref={imgRef}
          onLoad={onLoad}
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
  idx,
  open,
  onOpen,
  onRemove,
}: {
  entry: Extract<ShelfEntry, { kind: 'album' }>;
  idx: number;
  open: boolean;
  onOpen: (entry: Extract<ShelfEntry, { kind: 'album' }>) => void;
  onRemove: (entry: Extract<ShelfEntry, { kind: 'album' }>) => void;
}) {
  const { imgRef, tint, onLoad } = useShadowTint();
  return (
    <div className={styles.shelfCell} style={cellStyle(idx, tint)}>
      <button
        type="button"
        className={styles.shelfItem}
        onClick={() => onOpen(entry)}
        title={`${entry.albumName} — ${entry.artist} (${entry.tracks.length} 首)`}
        aria-expanded={open}
      >
        {/* Two stacked pseudo-cover layers behind the real cover sell
            the "this is a collection" feel without needing 3 different
            crops. The shelfCover sits on top. */}
        <span className={styles.shelfStackLayer} aria-hidden />
        <span className={`${styles.shelfStackLayer} ${styles.shelfStackLayer2}`} aria-hidden />
        <img
          ref={imgRef}
          onLoad={onLoad}
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

/* ─── Album dialog: centered modal with a "vinyl record" centerpiece.

   The vinyl is CSS-drawn: concentric grooves via repeating-radial-
   gradient, the album cover printed as the center label (the colored
   paper disc real records have), gentle infinite spin so it reads
   as "playing". Tracks list below.

   Centered (fixed top:50%/left:50%) so it never runs off-screen,
   unlike the previous anchored popover which could clip at viewport
   edges. Backdrop click + ESC + × all close it. */

const AlbumDialog = ({
  entry,
  onPick,
  onClose,
}: {
  entry: Extract<ShelfEntry, { kind: 'album' }>;
  onPick: (track: Track) => void;
  onClose: () => void;
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  /* Modal focus management: move focus into the dialog on open, hand
     it back to the triggering card on close, and wrap Tab at the
     edges so keyboard users can't wander into the dimmed page. */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = dialog.querySelectorAll<HTMLElement>('button');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKey);
    return () => {
      dialog.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, []);

  return (
    <>
      <div
        className={styles.dialogBackdrop}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        className={styles.albumDialog}
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.albumName} 的歌曲列表`}
        tabIndex={-1}
      >
        <div className={styles.vinylStage} aria-hidden>
          <div className={styles.vinyl}>
            <div
              className={styles.vinylLabel}
              style={{
                backgroundImage: `url(${proxyCoverUrl(entry.coverUrl)})`,
              }}
            />
            <div className={styles.vinylSpindle} />
          </div>
        </div>
        <header className={styles.dialogHead}>
          <h3 className={styles.dialogTitle}>{entry.albumName}</h3>
          <p className={styles.dialogSubtitle}>
            {entry.artist} · {entry.tracks.length} 首
          </p>
          <button
            type="button"
            className={styles.dialogClose}
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <ul className={styles.trackList}>
          {entry.tracks.map((t, i) => (
            <li key={t.sourceUrl}>
              <button
                type="button"
                className={styles.trackItem}
                onClick={() => onPick(t)}
              >
                <span className={styles.trackIndex}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className={styles.trackName}>{t.title}</span>
                <span className={styles.trackPlatform}>{t.platform}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
};
