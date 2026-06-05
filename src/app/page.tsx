'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import ShareCard from '@/components/ShareCard';
import LyricsPicker, { type LyricsState } from '@/components/LyricsPicker';
import SongDNAPanel, { type SongDNAState } from '@/components/SongDNAPanel';
import { useTrackInfo } from '@/hooks/useTrackInfo';
import { generateQrSvg } from '@/lib/qr';
import { renderCardCanvas } from '@/lib/renderCardCanvas';
import { fetchLyricsLrclib, fetchLyricsAi, parseLyrics } from '@/lib/lrclib';
import { streamSongDna } from '@/lib/songDnaClient';
import { proxyCoverUrl } from '@/lib/coverProxy';
import { extractCoverPalette } from '@/lib/colorExtraction';
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

/** Convert "#RRGGBB" into an "rgba(r,g,b,a)" string. */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  const [bloomVars, setBloomVars] = useState<CSSProperties | null>(null);

  useEffect(() => {
    setIsMobile(isMobileUA());
  }, []);

  const lyricLines = useMemo(() => {
    if (lyricsState.kind === 'found' && lyricsState.lines.length > 0) {
      return lyricsState.lines;
    }
    return manualText ? parseLyrics(manualText) : [];
  }, [lyricsState, manualText]);

  // Selected lyrics — always rendered in the song's original line order
  // (sorted by index), regardless of the order the user clicked them in.
  const selectedLyricLines = useMemo(
    () =>
      [...selectedIndices]
        .sort((a, b) => a - b)
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

  // Extract cover palette → push bloom colors as CSS vars on body. Effect
  // is the soft cover-derived halo behind everything on the page.
  useEffect(() => {
    if (state.kind !== 'success' || !state.track.coverUrl) {
      document.body.style.removeProperty('--bloom-1');
      document.body.style.removeProperty('--bloom-2');
      setBloomVars(null);
      return;
    }
    let cancelled = false;
    extractCoverPalette(proxyCoverUrl(state.track.coverUrl)).then((palette) => {
      if (cancelled) return;
      document.body.style.setProperty('--bloom-1', hexToRgba(palette.primary, 0.32));
      document.body.style.setProperty('--bloom-2', hexToRgba(palette.secondary, 0.22));
      setBloomVars({});
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    // Track change → abort any in-flight song-dna stream to free the
    // route handler and avoid late state updates landing on the new song.
    songDnaAbortRef.current?.abort();

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
    const { title, artist } = state.track;

    (async () => {
      try {
        const first = await fetchLyricsLrclib(title, artist, ctrl.signal);
        if (ctrl.signal.aborted) return;

        // Terminal outcomes from LRCLIB phase.
        if (first.source === 'lrclib' && first.lines && first.lines.length > 0) {
          setLyricsState({ kind: 'found', lines: first.lines, source: 'lrclib' });
          return;
        }
        if (first.source === 'ai' && first.lines && first.lines.length > 0) {
          setLyricsState({ kind: 'found', lines: first.lines, source: 'ai' });
          return;
        }
        if (first.source === 'ai-miss') {
          setLyricsState({ kind: 'not-found' });
          return;
        }

        // LRCLIB miss → tell user we're falling back to AI, then fire phase 2.
        setLyricsState({ kind: 'ai-searching' });
        const second = await fetchLyricsAi(title, artist, ctrl.signal);
        if (ctrl.signal.aborted) return;

        if (second.lines && second.lines.length > 0) {
          setLyricsState({ kind: 'found', lines: second.lines, source: 'ai' });
        } else {
          setLyricsState({ kind: 'not-found' });
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLyricsState({ kind: 'not-found' });
      }
    })();

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

  const songDnaAbortRef = useRef<AbortController | null>(null);

  const requestSongDna = useCallback(
    async (refresh = false) => {
      if (state.kind !== 'success') return;

      songDnaAbortRef.current?.abort();
      const ctrl = new AbortController();
      songDnaAbortRef.current = ctrl;

      setSongDnaState({
        kind: 'loading',
        phase: refresh ? 'refreshing' : 'reading',
        currentAction: refresh ? '正在重新检索…' : '正在读取这首歌的资料…',
      });

      const params = new URLSearchParams({
        title: state.track.title,
        artist: state.track.artist,
        platform: state.track.platform,
        sourceUrl: state.track.sourceUrl,
        ...(refresh ? { refresh: 'true' } : {}),
      });

      try {
        let receivedFinal = false;
        await streamSongDna(
          `/api/song-dna?${params.toString()}`,
          (event) => {
            if (event.kind === 'status') {
              setSongDnaState((s) =>
                s.kind === 'loading'
                  ? {
                      kind: 'loading',
                      phase: event.phase,
                      currentAction: phaseToText(event.phase, event.detail),
                    }
                  : s,
              );
            } else if (event.kind === 'final') {
              receivedFinal = true;
              if (event.payload.hasData) {
                setSongDnaState({
                  kind: 'found',
                  payload: event.payload,
                  cached: event.cached,
                  cachedAt: event.cachedAt,
                });
              } else {
                setSongDnaState({ kind: 'empty' });
              }
            } else if (event.kind === 'error') {
              setSongDnaState({ kind: 'error', message: event.message });
            }
          },
          ctrl.signal,
        );
        if (!receivedFinal && !ctrl.signal.aborted) {
          setSongDnaState({
            kind: 'error',
            message: '查询超时或流意外终止',
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSongDnaState({
          kind: 'error',
          message: err instanceof Error ? err.message : '请求失败',
        });
      }
    },
    [state],
  );

  function phaseToText(
    phase:
      | 'started'
      | 'searching'
      | 'analyzing'
      | 'synthesizing'
      | 'reading'
      | 'refreshing',
    detail?: string,
  ): string {
    switch (phase) {
      case 'started':
        return '正在准备检索…';
      case 'searching':
        return detail ? `正在搜索：${detail}` : 'AI 正在联网检索…';
      case 'analyzing':
        return detail ?? '正在阅读搜索结果…';
      case 'synthesizing':
        return '正在整合资料并撰写…';
      case 'reading':
        return '正在读取这首歌的资料…';
      case 'refreshing':
        return '正在重新检索…';
    }
  }

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

  void bloomVars; // referenced just for the linter — actual mutation is on body

  const stage: 'idle' | 'loading' | 'error' | 'success' =
    state.kind === 'idle' || state.kind === 'invalid'
      ? 'idle'
      : state.kind === 'loading'
        ? 'loading'
        : state.kind === 'error'
          ? 'error'
          : 'success';

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <a href="/" className={styles.navBrand}>
          <span className={styles.navMark} aria-hidden />
          <span className={styles.navLogo}>MusiCard</span>
          <span className={styles.navTagline}>music · shareable as image</span>
        </a>
        <div className={styles.navRight}>
          <a
            className={styles.navLink}
            href="https://github.com/shadycheer/MusiCard"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a className={styles.navLink} href="#about">
            关于
          </a>
        </div>
      </header>

      <main className={styles.main} data-stage={stage}>
        <div className={styles.inputWrap}>
          <label className={styles.inputLabel} htmlFor="track-input">
            LINK
          </label>
          <input
            id="track-input"
            className={styles.input}
            placeholder="Spotify / Apple Music / 网易云 单曲链接 →"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {state.kind === 'invalid' && (
            <p className={styles.errorText}>{state.message}</p>
          )}
          {stage === 'idle' && (
            <p className={styles.inputHint}>
              SUPPORTS · SPOTIFY · APPLE MUSIC · 网易云
            </p>
          )}
        </div>

        {stage === 'loading' && (
          <div className={styles.centerStage}>
            <div className={`${styles.skeleton} ${styles.fadeUp}`} />
          </div>
        )}

        {stage === 'error' && state.kind === 'error' && (
          <div className={styles.centerStage}>
            <div className={`${styles.errorBox} ${styles.fadeUp}`}>
              <p>{state.message}</p>
              <button
                className={styles.secondary}
                onClick={refetch}
                type="button"
              >
                重试
              </button>
            </div>
          </div>
        )}

        {state.kind === 'success' && qrSvg && (
          <div className={styles.workArea}>
            <div className={`${styles.cardCol} ${styles.cardColEnter}`}>
              <div className={styles.cardFrame}>
                <ShareCard
                  title={state.track.title}
                  artist={state.track.artist}
                  coverUrl={proxyCoverUrl(state.track.coverUrl)}
                  qrSvg={qrSvg}
                  platform={state.track.platform}
                  lyrics={selectedLyricLines}
                />
              </div>
              <button
                className={`${styles.primary} ${styles.fadeUpDelayed}`}
                disabled={!qrSvg || exporting}
                onClick={handleExport}
                type="button"
              >
                {exporting ? '导出中…' : isMobile ? '保存到相册' : '下载图片'}
              </button>
              {exportError && <p className={styles.errorText}>{exportError}</p>}
            </div>

            <div className={`${styles.panelsCol} ${styles.panelsColEnter}`}>
              <section className={styles.panel}>
                <header className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>
                    <span className={styles.panelKicker}>01</span>
                    歌词
                  </h2>
                  <div className={styles.panelMeta}>
                    <span>
                      {selectedIndices.length}/{MAX_SELECTED_LYRICS} selected
                    </span>
                  </div>
                </header>
                <div className={styles.panelBody}>
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
              </section>

              <section className={styles.panel}>
                <header className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>
                    <span className={styles.panelKicker}>02</span>
                    Song DNA
                  </h2>
                  <div className={styles.panelMeta}>
                    <span>歌曲背后的故事</span>
                  </div>
                </header>
                <div className={styles.panelBody}>
                  <SongDNAPanel state={songDnaState} onRequest={requestSongDna} />
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

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
