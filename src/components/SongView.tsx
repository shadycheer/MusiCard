'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ShareCard from '@/components/cards/ShareCard';
import CardSkeleton from '@/components/cards/CardSkeleton';
import LyricsPicker, { type LyricsState } from '@/components/lyrics/LyricsPicker';
import SongDnaPanel, {
  type SongDnaState,
  formatCacheTime,
} from '@/components/song-dna/SongDnaPanel';
import SongDnaDoneBadge from '@/components/song-dna/SongDnaDoneBadge';
import { useTrackInfo } from '@/hooks/useTrackInfo';
import { generateQrSvg } from '@/lib/card/qr';
import { renderCardCanvas } from '@/lib/card/renderCanvas';
import { fetchLyricsLrclib, fetchLyricsAi } from '@/lib/lyrics/lrclib';
import { streamSongDna } from '@/lib/song-dna/client';
import { proxyCoverUrl } from '@/lib/card/coverProxy';
import type { Platform } from '@/lib/music/url';
import { platforms } from '@/lib/music/platforms';
import styles from '@/app/page.module.css';

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
  return `${platforms[platform].filePrefix}-${cleaned || 'track'}.png`;
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

function isDesktopPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  const ua = navigator.userAgent;
  return /Mac|Win|Linux|CrOS/i.test(platform) || /Macintosh|Windows|X11|Linux/i.test(ua);
}

function shouldUseMobileShare(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (isDesktopPlatform()) return false;
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

type Props = {
  /** Reconstructed canonical URL for the track (built from slug params).
   *  Same shape as what useTrackInfo accepts on the home page. */
  canonicalUrl: string;
};

/* The whole song-display surface, extracted from the original page.tsx
   so it can be rendered both at /[slug] (primary) and reused if we
   ever need a previewer or embed. Owns: track fetch, lyrics state
   machine (LRCLIB+AI race), SongDNA stream + badge migration, export.
   Does NOT own: input field, history shelf — those live on the home. */
export default function SongView({ canonicalUrl }: Props) {
  const { state, refetch } = useTrackInfo(canonicalUrl);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [useMobileShare, setUseMobileShare] = useState(false);
  const [lyricsState, setLyricsState] = useState<LyricsState>({ kind: 'idle' });
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [songDnaState, setSongDnaState] = useState<SongDnaState>({ kind: 'idle' });
  type BadgeStage = 'none' | 'helix-large' | 'migrating' | 'header-docked';
  const [badgeStage, setBadgeStage] = useState<BadgeStage>('none');
  const [migrationCoords, setMigrationCoords] = useState<
    | { from: { x: number; y: number }; to: { x: number; y: number } }
    | null
  >(null);
  const helixAnchorRef = useRef<HTMLDivElement>(null);
  const headerBadgeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    setUseMobileShare(shouldUseMobileShare());
  }, []);

  const [pageScrolled, setPageScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setPageScrolled(window.scrollY > 180);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const hasSongDnaContent = useMemo(() => {
    if (songDnaState.kind === 'found') return true;
    if (
      songDnaState.kind === 'loading' &&
      (songDnaState.streamedContent ?? '').length > 0
    )
      return true;
    return false;
  }, [songDnaState]);

  const isSongDnaCachedHit =
    songDnaState.kind === 'found' && songDnaState.cached === true;

  useEffect(() => {
    if (!hasSongDnaContent) {
      setBadgeStage('none');
      setMigrationCoords(null);
      return;
    }
    if (isSongDnaCachedHit) {
      setBadgeStage('header-docked');
      setMigrationCoords(null);
      return;
    }
    const tHelix = window.setTimeout(() => setBadgeStage('helix-large'), 450);
    const tMigrate = window.setTimeout(() => {
      if (helixAnchorRef.current && headerBadgeRef.current) {
        const h = helixAnchorRef.current.getBoundingClientRect();
        const hd = headerBadgeRef.current.getBoundingClientRect();
        setMigrationCoords({
          from: { x: h.left + h.width / 2, y: h.top + h.height / 2 },
          to: { x: hd.left + hd.width / 2, y: hd.top + hd.height / 2 },
        });
      }
      setBadgeStage('migrating');
    }, 650);
    return () => {
      window.clearTimeout(tHelix);
      window.clearTimeout(tMigrate);
    };
  }, [hasSongDnaContent, isSongDnaCachedHit]);

  const lyricLines = useMemo(
    () =>
      lyricsState.kind === 'found' && lyricsState.lines.length > 0
        ? lyricsState.lines
        : [],
    [lyricsState],
  );

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

  useEffect(() => {
    songDnaAbortRef.current?.abort();

    if (state.kind !== 'success') {
      setLyricsState({ kind: 'idle' });
      setSelectedIndices([]);
      setSongDnaState({ kind: 'idle' });
      return;
    }
    setSelectedIndices([]);
    setSongDnaState({ kind: 'idle' });
    setLyricsState({ kind: 'loading' });

    const ctrl = new AbortController();
    const { title, artist, platform, sourceUrl } = state.track;
    const neteaseId =
      platform === 'netease'
        ? (platforms.netease.trackIdFromUrl(sourceUrl) ?? undefined)
        : undefined;
    const qqMid =
      platform === 'qqMusic'
        ? (platforms.qqMusic.trackIdFromUrl(sourceUrl) ?? undefined)
        : undefined;

    /* Race orchestration — see history at src/app/page.tsx@89fb0e1 for
       the rationale. Both fetches start at t=0 with independent abort
       controllers; LRCLIB always wins authoritative hits and aborts AI;
       on lrclib-miss we await the already-in-flight AI request. */
    const lrclibCtrl = new AbortController();
    const aiCtrl = new AbortController();
    ctrl.signal.addEventListener('abort', () => {
      lrclibCtrl.abort();
      aiCtrl.abort();
    });

    const lrclibP = fetchLyricsLrclib(title, artist, lrclibCtrl.signal, neteaseId, qqMid)
      .catch((err) => {
        if (lrclibCtrl.signal.aborted) return null;
        if (err instanceof DOMException && err.name === 'AbortError') return null;
        return null;
      });
    const aiP = fetchLyricsAi(title, artist, aiCtrl.signal).catch((err) => {
      if (aiCtrl.signal.aborted) return null;
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      return null;
    });

    (async () => {
      const first = await lrclibP;
      if (ctrl.signal.aborted) return;

      if (first) {
        if (
          (first.source === 'netease' ||
            first.source === 'qq' ||
            first.source === 'lrclib') &&
          first.lines &&
          first.lines.length > 0
        ) {
          aiCtrl.abort();
          setLyricsState({ kind: 'found', lines: first.lines, source: 'lrclib' });
          return;
        }
        if (first.source === 'ai' && first.lines && first.lines.length > 0) {
          aiCtrl.abort();
          setLyricsState({ kind: 'found', lines: first.lines, source: 'ai' });
          return;
        }
        if (first.source === 'ai-miss') {
          aiCtrl.abort();
          setLyricsState({ kind: 'not-found' });
          return;
        }
      }

      setLyricsState({ kind: 'ai-searching' });
      const second = await aiP;
      if (ctrl.signal.aborted) return;
      if (second && second.lines && second.lines.length > 0) {
        setLyricsState({ kind: 'found', lines: second.lines, source: 'ai' });
      } else {
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
        streamedContent: '',
      });

      const params = new URLSearchParams({
        title: state.track.title,
        artist: state.track.artist,
        platform: state.track.platform,
        sourceUrl: state.track.sourceUrl,
        ...(refresh ? { refresh: 'true' } : {}),
      });

      try {
        let receivedTerminal = false;
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
                      streamedContent: s.streamedContent ?? '',
                    }
                  : s,
              );
            } else if (event.kind === 'chunk') {
              setSongDnaState((s) =>
                s.kind === 'loading'
                  ? {
                      ...s,
                      streamedContent: (s.streamedContent ?? '') + event.text,
                    }
                  : s,
              );
            } else if (event.kind === 'final') {
              receivedTerminal = true;
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
              receivedTerminal = true;
              setSongDnaState({ kind: 'error', message: event.message });
            }
          },
          ctrl.signal,
        );
        if (!receivedTerminal && !ctrl.signal.aborted) {
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
      default:
        return detail ?? '正在处理资料…';
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

      const mobileShare = shouldUseMobileShare();
      setUseMobileShare(mobileShare);

      if (mobileShare) {
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

  const stage: 'loading' | 'error' | 'success' =
    state.kind === 'loading'
      ? 'loading'
      : state.kind === 'error' || state.kind === 'invalid'
        ? 'error'
        : state.kind === 'success'
          ? 'success'
          : 'loading';

  return (
    <div className={styles.page}>
      {state.kind === 'success' && (
        <div
          className={styles.coverBackdrop}
          aria-hidden
          style={{
            backgroundImage: `url("${proxyCoverUrl(state.track.coverUrl)}")`,
          }}
        />
      )}

      <header
        className={`${styles.topBar} ${pageScrolled ? styles.topBarScrolled : ''}`}
      >
        <a href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden />
          <span className={styles.brandText}>MusiCard</span>
        </a>
        <div
          className={`${styles.topBarTrack} ${
            state.kind === 'success' && pageScrolled
              ? styles.topBarTrackVisible
              : ''
          }`}
          aria-live="polite"
        >
          {state.kind === 'success' ? state.track.title : ''}
        </div>
        <a
          className={styles.iconLink}
          href="https://github.com/shadycheer/MusiCard"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub repository"
          title="GitHub"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
            <path d="M12 .5C5.65.5.5 5.66.5 12.02c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.16c-3.2.69-3.87-1.36-3.87-1.36-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.21-1.5 3.18-1.18 3.18-1.18.63 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.55A11.52 11.52 0 0 0 23.5 12.02C23.5 5.66 18.35.5 12 .5Z" />
          </svg>
        </a>
      </header>

      <main className={styles.main} data-stage={stage}>
        {stage === 'loading' && (
          <section className={styles.centeredCard} aria-label="加载中" key="stage-loading">
            <CardSkeleton platform={state.kind === 'loading' ? state.platform : 'spotify'} />
            <p className={styles.centeredHint}>正在读取链接…</p>
          </section>
        )}

        {stage === 'error' && (
          <section className={styles.centeredCard} aria-label="读取失败" key="stage-error">
            <div className={styles.errorPreview}>读取失败</div>
            <p className={styles.centeredHint}>
              {state.kind === 'error' || state.kind === 'invalid' ? state.message : '链接无效'}
            </p>
            <button className={styles.secondary} onClick={refetch} type="button">
              重试
            </button>
            <a className={styles.secondary} href="/">返回首页</a>
          </section>
        )}

        {state.kind === 'success' && qrSvg && (
          <div className={styles.workArea} key="stage-success">
            <section className={styles.previewPane} aria-label="卡片预览">
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
              <div className={styles.previewActions}>
                <button
                  className={styles.primary}
                  disabled={!qrSvg || exporting}
                  onClick={handleExport}
                  type="button"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M8 2v9m0 0-3-3m3 3 3-3M3 14h10" />
                  </svg>
                  <span>
                    {exporting ? '导出中…' : useMobileShare ? '保存到相册' : '下载图片'}
                  </span>
                </button>
                {exportError && <p className={styles.errorText}>{exportError}</p>}
              </div>
            </section>

            <aside className={styles.panelsCol}>
              <section className={styles.panel}>
                <header className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>歌词</h2>
                  <span className={styles.panelMeta}>
                    {selectedIndices.length}/{MAX_SELECTED_LYRICS}
                  </span>
                </header>
                <div className={styles.panelBody}>
                  <LyricsPicker
                    state={lyricsState}
                    lines={lyricLines}
                    selected={selectedIndices}
                    onToggle={toggleLyric}
                    maxSelected={MAX_SELECTED_LYRICS}
                  />
                </div>
              </section>

              <section className={styles.panel}>
                <header className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>Song DNA</h2>
                  <div className={styles.headerActions}>
                    {badgeStage === 'header-docked' &&
                      songDnaState.kind === 'found' &&
                      songDnaState.cached &&
                      songDnaState.cachedAt && (
                        <span className={styles.headerStamp}>
                          {formatCacheTime(songDnaState.cachedAt)}
                        </span>
                      )}
                    <span
                      ref={headerBadgeRef}
                      className={`${styles.headerBadgeSlot} ${
                        songDnaState.kind === 'loading' && !hasSongDnaContent
                          ? styles.headerBadgeSlotThinking
                          : ''
                      }`}
                      aria-hidden={
                        badgeStage !== 'header-docked' &&
                        !(songDnaState.kind === 'loading' && !hasSongDnaContent)
                      }
                    >
                      {badgeStage === 'header-docked' &&
                        (songDnaState.kind === 'found' && songDnaState.cached ? (
                          <button
                            type="button"
                            className={styles.headerRefresh}
                            onClick={() => requestSongDna(true)}
                            aria-label="重新检索"
                            title="重新检索"
                          >
                            <svg
                              viewBox="0 0 16 16"
                              width="11"
                              height="11"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.7"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="M13.5 8a5.5 5.5 0 1 1-1.62-3.9" />
                              <path d="M13.5 2.5v3h-3" />
                            </svg>
                          </button>
                        ) : (
                          <SongDnaDoneBadge size="small" />
                        ))}
                      {songDnaState.kind === 'loading' && !hasSongDnaContent && (
                        <span
                          className={styles.headerThinking}
                          role="status"
                          aria-live="polite"
                        >
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            aria-hidden
                          >
                            <path d="M 8 2 A 6 6 0 1 1 2 8" />
                          </svg>
                          <span className={styles.headerThinkingText}>
                            {songDnaState.currentAction || '正在思考…'}
                          </span>
                        </span>
                      )}
                    </span>
                  </div>
                </header>
                <div className={styles.panelBody}>
                  <SongDnaPanel
                    state={songDnaState}
                    onRequest={requestSongDna}
                    badgeStage={badgeStage}
                    helixAnchorRef={helixAnchorRef}
                  />
                </div>
              </section>
            </aside>
          </div>
        )}
      </main>

      {badgeStage === 'migrating' && migrationCoords && (
        <div
          className={styles.migratingBadge}
          style={{
            // @ts-expect-error CSS vars on inline style
            '--sx': `${migrationCoords.from.x}px`,
            '--sy': `${migrationCoords.from.y}px`,
            '--ex': `${migrationCoords.to.x}px`,
            '--ey': `${migrationCoords.to.y}px`,
          }}
          onAnimationEnd={() => setBadgeStage('header-docked')}
          aria-hidden
        >
          <SongDnaDoneBadge size="large" />
        </div>
      )}

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
