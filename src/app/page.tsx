'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ShareCard from '@/components/ShareCard';
import LyricsPicker, { type LyricsState } from '@/components/LyricsPicker';
import SongDNAPanel, { type SongDNAState } from '@/components/SongDNAPanel';
import { useTrackInfo } from '@/hooks/useTrackInfo';
import { generateQrSvg } from '@/lib/qr';
import { renderCardCanvas } from '@/lib/renderCardCanvas';
import { fetchLyrics, parseLyrics } from '@/lib/lrclib';
import { proxyCoverUrl } from '@/lib/coverProxy';
import type { Platform } from '@/lib/musicUrl';
import styles from './page.module.css';

function recordEvent(type: 'view' | 'export'): void {
  fetch('/api/track-view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type }),
    keepalive: true,
  }).catch(() => {});
}

const MAX_SELECTED_LYRICS = 4;

function sanitizeFilename(title: string, platform: Platform): string {
  const cleaned = title
    .replace(/[^\w一-鿿-]+/g, '_')
    .slice(0, 40)
    .replace(/^_+|_+$/g, '');
  const prefix =
    platform === 'spotify'
      ? 'spotify-card'
      : platform === 'netease'
        ? 'netease-card'
        : 'apple-music-card';
  return `${prefix}-${cleaned || 'track'}.png`;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      'image/png',
    );
  });
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function isMobileUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

type ShareResult = 'ok' | 'cancelled' | 'unsupported';

async function tryShareFile(blob: Blob, filename: string): Promise<ShareResult> {
  if (typeof navigator === 'undefined') return 'unsupported';
  if (typeof navigator.share !== 'function') return 'unsupported';

  const file = new File([blob], filename, { type: 'image/png' });
  if (
    typeof navigator.canShare !== 'function' ||
    !navigator.canShare({ files: [file] })
  ) {
    return 'unsupported';
  }

  try {
    await navigator.share({ files: [file] });
    return 'ok';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    return 'unsupported';
  }
}

function formatTodayLabel(): string {
  // E.g. "Vol. 06 · 06.05.2026" — small fixed string regenerated per render.
  const d = new Date();
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `Vol. ${mm} · ${mm}.${dd}.${yy}`;
}

export default function Page() {
  const [input, setInput] = useState('');
  const { state, refetch } = useTrackInfo(input);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [lyricsState, setLyricsState] = useState<LyricsState>({ kind: 'idle' });
  const [manualText, setManualText] = useState('');
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [songDnaState, setSongDnaState] = useState<SongDNAState>({ kind: 'idle' });

  useEffect(() => {
    setIsMobile(isMobileUA());
  }, []);

  const lyricLines = useMemo(() => {
    if (lyricsState.kind === 'found' && lyricsState.lines.length > 0) {
      return lyricsState.lines;
    }
    return manualText ? parseLyrics(manualText) : [];
  }, [lyricsState, manualText]);

  const selectedLyricLines = useMemo(
    () =>
      selectedIndices
        .map((i) => lyricLines[i])
        .filter((s): s is string => typeof s === 'string'),
    [selectedIndices, lyricLines],
  );

  useEffect(() => {
    if (state.kind !== 'success') {
      setQrSvg('');
      return;
    }
    let cancelled = false;
    generateQrSvg(state.track.sourceUrl).then((svg) => {
      if (!cancelled) setQrSvg(svg);
    });
    recordEvent('view');
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (state.kind !== 'success') {
      setLyricsState({ kind: 'idle' });
      setManualText('');
      setSelectedIndices([]);
      setSongDnaState({ kind: 'idle' });
      return;
    }
    setSelectedIndices([]);
    setManualText('');
    setSongDnaState({ kind: 'idle' });
    setLyricsState({ kind: 'loading' });

    const ctrl = new AbortController();
    fetchLyrics(state.track.title, state.track.artist, ctrl.signal)
      .then((lines) => {
        if (ctrl.signal.aborted) return;
        if (lines && lines.length > 0) {
          setLyricsState({ kind: 'found', lines });
        } else {
          setLyricsState({ kind: 'not-found' });
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setLyricsState({ kind: 'not-found' });
      });

    return () => ctrl.abort();
  }, [state]);

  useEffect(() => {
    return () => {
      if (fallbackImageUrl) URL.revokeObjectURL(fallbackImageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleLyric = (idx: number) => {
    setSelectedIndices((prev) => {
      const at = prev.indexOf(idx);
      if (at >= 0) return prev.filter((i) => i !== idx);
      if (prev.length >= MAX_SELECTED_LYRICS) return [...prev.slice(1), idx];
      return [...prev, idx];
    });
  };

  const closeFallback = () => {
    setFallbackImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const requestSongDna = useCallback(async () => {
    if (state.kind !== 'success') return;
    setSongDnaState({ kind: 'loading' });
    try {
      const res = await fetch('/api/song-dna', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: state.track.title,
          artist: state.track.artist,
        }),
      });
      const data = (await res.json()) as
        | { hasStory: true; text: string; sources?: string[] }
        | { hasStory: false }
        | { error: string };
      if (!res.ok || 'error' in data) {
        const msg = 'error' in data ? data.error : '请求失败';
        setSongDnaState({ kind: 'error', message: msg });
        return;
      }
      if (!data.hasStory) {
        setSongDnaState({ kind: 'empty' });
        return;
      }
      setSongDnaState({ kind: 'found', text: data.text, sources: data.sources });
    } catch (err) {
      setSongDnaState({
        kind: 'error',
        message: err instanceof Error ? err.message : '请求失败',
      });
    }
  }, [state]);

  const handleExport = async () => {
    if (state.kind !== 'success' || !qrSvg) return;
    setExporting(true);
    setExportError(null);
    try {
      const canvas = await renderCardCanvas({
        title: state.track.title,
        artist: state.track.artist,
        coverUrl: proxyCoverUrl(state.track.coverUrl),
        qrSvg,
        platform: state.track.platform,
        lyrics: selectedLyricLines,
        targetWidth: 1920,
      });

      const blob = await canvasToBlob(canvas);
      const filename = sanitizeFilename(state.track.title, state.track.platform);

      if (isMobile) {
        const result = await tryShareFile(blob, filename);
        if (result === 'unsupported') {
          const url = URL.createObjectURL(blob);
          setFallbackImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
      } else {
        const url = URL.createObjectURL(blob);
        triggerDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }

      recordEvent('export');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const issueLine = formatTodayLabel();
  const hasTrack = state.kind === 'success';

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <a href="/" className={styles.mastheadBrand}>
          <span className={styles.mastheadLogo}>MusiCard</span>
          <span className={styles.mastheadTagline}>· 音乐随笔与分享卡</span>
        </a>
        <nav className={styles.mastheadNav}>
          <a
            className={styles.navLink}
            href="https://github.com/shadycheer/MusiCard"
            target="_blank"
            rel="noreferrer"
          >
            Github
          </a>
          <a className={styles.navLink} href="#about">
            关于
          </a>
        </nav>
      </header>

      <section className={styles.editorial}>
        <div className={styles.issueLine}>{issueLine}</div>
        <h1 className={styles.headline}>
          链接人类的，<br />
          <span className={styles.headlineAccent}>我希望不是链接。</span>
        </h1>
        <p className={styles.lede}>
          粘贴一条 Spotify / Apple Music / 网易云 的单曲链接，
          换回一张能直接发到聊天里的卡片，以及——
          如果这首歌愿意——一段它背后的故事。
        </p>
      </section>

      <section className={styles.inputRow}>
        <label className={styles.inputLabel} htmlFor="track-input">
          Track Link
        </label>
        <input
          id="track-input"
          className={styles.input}
          placeholder="把链接贴到这里 →"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {state.kind === 'invalid' && (
          <p className={styles.errorText}>{state.message}</p>
        )}
      </section>

      <section className={styles.workspace}>
        {/* Column 1 — meta sidebar */}
        <aside className={styles.metaCol}>
          <div className={styles.metaBlock}>
            <p className={styles.metaLabel}>Curated by</p>
            <p className={styles.metaValue}>shadycheer</p>
          </div>
          <div className={styles.metaBlock}>
            <p className={styles.metaLabel}>Issue</p>
            <p className={styles.metaValue}>{issueLine.split(' · ')[0]}</p>
          </div>
          {hasTrack && (
            <div className={styles.metaBlock}>
              <p className={styles.metaLabel}>On the cover</p>
              <p className={styles.metaValue}>{state.track.title}</p>
            </div>
          )}
          <p className={styles.dropCap}>♪</p>
        </aside>

        {/* Column 2 — card stage */}
        <div className={styles.cardCol}>
          <div className={styles.cardStage}>
            {state.kind === 'idle' && (
              <div className={styles.placeholder}>
                <span className={styles.placeholderArrow}>↑</span>
                <p className={styles.placeholderHint}>
                  上面那一行，粘个歌曲链接，
                  这里就会浮出一张可以分享出去的卡片。
                </p>
              </div>
            )}
            {state.kind === 'loading' && <div className={styles.skeleton} />}
            {state.kind === 'error' && (
              <div className={styles.errorBox}>
                <p>{state.message}</p>
                <button
                  className={`${styles.button} ${styles.secondary}`}
                  onClick={refetch}
                >
                  重试
                </button>
              </div>
            )}
            {hasTrack && qrSvg && (
              <div className={`${styles.cardFrame} ${styles.reveal}`}>
                <ShareCard
                  title={state.track.title}
                  artist={state.track.artist}
                  coverUrl={proxyCoverUrl(state.track.coverUrl)}
                  qrSvg={qrSvg}
                  platform={state.track.platform}
                  lyrics={selectedLyricLines}
                />
              </div>
            )}
          </div>

          <button
            className={styles.button}
            disabled={!hasTrack || !qrSvg || exporting}
            onClick={handleExport}
          >
            {exporting ? '导出中…' : isMobile ? '保存到相册' : '下载图片'}
          </button>

          {exportError && <p className={styles.errorText}>{exportError}</p>}
        </div>

        {/* Column 3 — essay (lyrics + SongDNA) */}
        <aside className={styles.essayCol}>
          {hasTrack && (
            <div className={`${styles.essaySection} ${styles.reveal}`}>
              <div className={styles.essayHeader}>
                <h2 className={styles.essayTitle}>歌词</h2>
                <span className={styles.essayMeta}>
                  {selectedIndices.length}/{MAX_SELECTED_LYRICS} selected
                </span>
              </div>
              <LyricsPicker
                state={lyricsState}
                lines={lyricLines}
                manualText={manualText}
                onManualTextChange={setManualText}
                selected={selectedIndices}
                onToggle={toggleLyric}
                maxSelected={MAX_SELECTED_LYRICS}
              />
            </div>
          )}

          {hasTrack && (
            <div className={`${styles.essaySection} ${styles.reveal}`}>
              <div className={styles.essayHeader}>
                <h2 className={styles.essayTitle}>Song DNA</h2>
                <span className={styles.essayMeta}>歌曲背后的故事</span>
              </div>
              <SongDNAPanel state={songDnaState} onRequest={requestSongDna} />
            </div>
          )}
        </aside>
      </section>

      {fallbackImageUrl && (
        <div
          className={styles.modalBackdrop}
          onClick={closeFallback}
          role="dialog"
          aria-modal="true"
        >
          <div
            className={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={closeFallback}
              aria-label="关闭"
            >
              ✕
            </button>
            <p className={styles.modalHint}>长按图片保存到相册</p>
            <img
              className={styles.modalImage}
              src={fallbackImageUrl}
              alt="生成的分享卡"
            />
          </div>
        </div>
      )}
    </div>
  );
}
