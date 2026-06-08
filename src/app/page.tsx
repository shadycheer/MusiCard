'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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

export default function Page() {
  const [input, setInput] = useState('');
  const { state, refetch } = useTrackInfo(input);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [useMobileShare, setUseMobileShare] = useState(false);
  const [lyricsState, setLyricsState] = useState<LyricsState>({ kind: 'idle' });
  const [manualText, setManualText] = useState('');
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [songDnaState, setSongDnaState] = useState<SongDNAState>({ kind: 'idle' });

  useEffect(() => {
    setUseMobileShare(shouldUseMobileShare());
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
      let shouldTryAi = false;

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

        shouldTryAi = true;
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // LRCLIB being slow/down should not end the flow; AI is the fallback.
        shouldTryAi = true;
      }

      if (shouldTryAi) {
        setLyricsState({ kind: 'ai-searching' });
      }

      try {
        const second = await fetchLyricsAi(title, artist, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (second.lines && second.lines.length > 0) {
          setLyricsState({ kind: 'found', lines: second.lines, source: 'ai' });
        } else if (second.error) {
          setLyricsState({
            kind: 'not-found',
            message: 'AI 歌词服务暂时没返回可用结果。可以先手动粘贴歌词：',
          });
        } else {
          setLyricsState({ kind: 'not-found' });
        }
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLyricsState({
          kind: 'not-found',
          message: 'AI 歌词服务暂时没返回可用结果。可以先手动粘贴歌词：',
        });
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
      <header className={styles.topBar}>
        <a href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden />
          <span className={styles.brandText}>MusiCard</span>
        </a>

        <div className={styles.inputWrap}>
          <label className={styles.inputLabel} htmlFor="track-input">
            音乐链接
          </label>
          <input
            id="track-input"
            className={styles.input}
            placeholder="粘贴 Spotify / Apple Music / 网易云 单曲链接"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          {state.kind === 'invalid' && (
            <p className={styles.inputError}>{state.message}</p>
          )}
        </div>

        <div className={styles.topLinks}>
          <a
            className={styles.topLink}
            href="https://github.com/shadycheer/MusiCard"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </div>
      </header>

      <main className={styles.main} data-stage={stage}>
        {stage === 'idle' && (
          <section className={styles.hero} aria-label="MusiCard 介绍">
            <h1 className={styles.heroTitle}>
              把一首歌变成可以分享的卡片
            </h1>
            <ol className={styles.heroSteps}>
              <li className={styles.heroStep}>
                <span className={styles.heroStepIndex}>1</span>
                <p className={styles.heroStepTitle}>贴链接</p>
                <p className={styles.heroStepDesc}>Spotify · Apple Music · 网易云</p>
              </li>
              <li className={styles.heroStep}>
                <span className={styles.heroStepIndex}>2</span>
                <p className={styles.heroStepTitle}>选歌词 · 读故事</p>
                <p className={styles.heroStepDesc}>最多 4 行，AI 帮你考据</p>
              </li>
              <li className={styles.heroStep}>
                <span className={styles.heroStepIndex}>3</span>
                <p className={styles.heroStepTitle}>下载图片</p>
                <p className={styles.heroStepDesc}>PNG，直接发</p>
              </li>
            </ol>
          </section>
        )}

        {stage === 'loading' && (
          <div className={styles.statusLayout}>
            <section className={styles.previewPane} aria-label="加载中">
              <div className={styles.skeleton} />
            </section>
            <aside className={styles.statusPanel}>
              <p className={styles.statusTitle}>解析中</p>
            </aside>
          </div>
        )}

        {stage === 'error' && state.kind === 'error' && (
          <div className={styles.statusLayout}>
            <section className={styles.previewPane} aria-label="读取失败">
              <div className={styles.errorPreview}>读取失败</div>
            </section>
            <aside className={styles.statusPanel}>
              <p className={styles.statusTitle}>{state.message}</p>
              <button
                className={styles.secondary}
                onClick={refetch}
                type="button"
              >
                重试
              </button>
            </aside>
          </div>
        )}

        {state.kind === 'success' && qrSvg && (
          <div className={styles.workArea}>
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
                  {exporting ? '导出中…' : useMobileShare ? '保存到相册' : '下载图片'}
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
                  <h2 className={styles.panelTitle}>Song DNA</h2>
                </header>
                <div className={styles.panelBody}>
                  <SongDNAPanel state={songDnaState} onRequest={requestSongDna} />
                </div>
              </section>
            </aside>
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
