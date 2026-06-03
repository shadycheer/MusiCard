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

function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function Page() {
  const [input, setInput] = useState('');
  const { state, refetch } = useTrackInfo(input);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lyricsState, setLyricsState] = useState<LyricsState>({ kind: 'idle' });
  const [manualText, setManualText] = useState('');
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

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

  const toggleLyric = (idx: number) => {
    setSelectedIndices((prev) => {
      const at = prev.indexOf(idx);
      if (at >= 0) return prev.filter((i) => i !== idx);
      if (prev.length >= MAX_SELECTED_LYRICS) return [...prev.slice(1), idx];
      return [...prev, idx];
    });
  };

  const handleDownload = async () => {
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
      downloadDataUrl(
        canvas.toDataURL('image/png'),
        sanitizeFilename(state.track.title, state.track.platform),
      );
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
          onClick={handleDownload}
        >
          {exporting ? '导出中…' : '下载图片'}
        </button>

        {exportError && <p className={styles.errorText}>{exportError}</p>}
      </div>
    </div>
  );
}
