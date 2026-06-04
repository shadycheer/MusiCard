'use client';

import { useEffect, useMemo, useState } from 'react';
import ShareCard from '@/components/ShareCard';
import LyricsPicker, { type LyricsState } from '@/components/LyricsPicker';
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
  const prefix = platform === 'spotify' ? 'spotify-card' : 'apple-music-card';
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

  // Defer UA check to client-side to avoid hydration mismatch.
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
      return;
    }
    setSelectedIndices([]);
    setManualText('');
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
          // No native share path → show the modal so user can long-press save.
          const url = URL.createObjectURL(blob);
          setFallbackImageUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        }
        // 'ok' / 'cancelled' → user already made a choice, no extra UI.
      } else {
        // Desktop: just trigger download.
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

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.heading}>音乐分享卡</h1>

        <input
          className={styles.input}
          placeholder="粘贴 Spotify 或 Apple Music 单曲链接"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />

        {state.kind === 'invalid' && (
          <p className={styles.errorText}>{state.message}</p>
        )}

        <div className={styles.previewWrap}>
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
          {state.kind === 'success' && qrSvg && (
            <ShareCard
              title={state.track.title}
              artist={state.track.artist}
              coverUrl={proxyCoverUrl(state.track.coverUrl)}
              qrSvg={qrSvg}
              platform={state.track.platform}
              lyrics={selectedLyricLines}
            />
          )}
        </div>

        {state.kind === 'success' && (
          <LyricsPicker
            state={lyricsState}
            lines={lyricLines}
            manualText={manualText}
            onManualTextChange={setManualText}
            selected={selectedIndices}
            onToggle={toggleLyric}
            maxSelected={MAX_SELECTED_LYRICS}
          />
        )}

        <button
          className={styles.button}
          disabled={state.kind !== 'success' || !qrSvg || exporting}
          onClick={handleExport}
        >
          {exporting ? '导出中…' : isMobile ? '保存到相册' : '下载图片'}
        </button>

        {exportError && <p className={styles.errorText}>{exportError}</p>}
      </div>

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
