import { useEffect, useMemo, useState } from 'react';
import { fetchLyricsLrclib, fetchLyricsAi } from '@/lib/lyrics/lrclib';
import { platforms } from '@/lib/music/platforms';
import type { Track } from '@/lib/music/songlink';
import type { LyricsState } from '@/components/lyrics/LyricsPicker';

/* Lyrics state machine: authoritative phase, then AI fallback —
   STRICTLY sequential. Racing them from t=0 burned a paid web-search
   call on every song and let the slow AI write clobber freshly cached
   authoritative lyrics. Sentinel `ai-miss` short-circuits to
   not-found (a previous AI attempt already failed and was cached). */

type LyricsControls = {
  state: LyricsState;
  lines: string[];
  selectedIndices: number[];
  selectedLines: string[];
  toggleLine: (idx: number) => void;
};

export function useLyricsRace(
  track: Track | null,
  maxSelected = 4,
): LyricsControls {
  const [state, setState] = useState<LyricsState>({ kind: 'idle' });
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);

  useEffect(() => {
    setSelectedIndices([]);
    if (!track) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'loading' });

    const ctrl = new AbortController();
    const { title, artist, platform, sourceUrl, durationMs } = track;
    /* Platform-native track id helps LRCLIB's NetEase/QQ side routes
       hit faster (or hit at all when the song lacks Western metadata).
       Apple Music + Spotify go through LRCLIB's primary path which
       just needs title + artist. */
    const neteaseId =
      platform === 'netease'
        ? (platforms.netease.trackIdFromUrl(sourceUrl) ?? undefined)
        : undefined;
    const qqMid =
      platform === 'qqMusic'
        ? (platforms.qqMusic.trackIdFromUrl(sourceUrl) ?? undefined)
        : undefined;

    const lrclibCtrl = new AbortController();
    const aiCtrl = new AbortController();
    ctrl.signal.addEventListener('abort', () => {
      lrclibCtrl.abort();
      aiCtrl.abort();
    });

    (async () => {
      const first = await fetchLyricsLrclib(
        title,
        artist,
        lrclibCtrl.signal,
        neteaseId,
        qqMid,
        durationMs,
      ).catch(() => null);
      if (ctrl.signal.aborted) return;

      if (first) {
        if (
          (first.source === 'netease' ||
            first.source === 'qq' ||
            first.source === 'lrclib') &&
          first.lines &&
          first.lines.length > 0
        ) {
          setState({ kind: 'found', lines: first.lines, source: 'lrclib' });
          return;
        }
        if (first.source === 'ai' && first.lines && first.lines.length > 0) {
          setState({ kind: 'found', lines: first.lines, source: 'ai' });
          return;
        }
        if (first.source === 'ai-miss') {
          setState({ kind: 'not-found' });
          return;
        }
      }

      setState({ kind: 'ai-searching' });
      const second = await fetchLyricsAi(title, artist, aiCtrl.signal).catch(
        () => null,
      );
      if (ctrl.signal.aborted) return;
      if (second && second.lines && second.lines.length > 0) {
        /* phase=ai can answer from cache with an authoritative source
           that landed meanwhile (e.g. another tab) — label honestly. */
        setState({
          kind: 'found',
          lines: second.lines,
          source: second.source === 'ai' ? 'ai' : 'lrclib',
        });
      } else {
        setState({ kind: 'not-found' });
      }
    })();

    return () => ctrl.abort();
  }, [track]);

  const lines = useMemo(
    () =>
      state.kind === 'found' && state.lines.length > 0 ? state.lines : [],
    [state],
  );

  const selectedLines = useMemo(
    () =>
      [...selectedIndices]
        .sort((a, b) => a - b)
        .map((i) => lines[i])
        .filter((s): s is string => typeof s === 'string'),
    [selectedIndices, lines],
  );

  /* FIFO-with-cap: when at capacity, dropping the oldest selection
     keeps the gesture forgiving — pick a fifth line and the first
     just rolls off instead of silently failing. */
  const toggleLine = (idx: number) => {
    setSelectedIndices((prev) => {
      const at = prev.indexOf(idx);
      if (at >= 0) return prev.filter((i) => i !== idx);
      if (prev.length >= maxSelected) return [...prev.slice(1), idx];
      return [...prev, idx];
    });
  };

  return { state, lines, selectedIndices, selectedLines, toggleLine };
}
