import { useEffect, useMemo, useState } from 'react';
import { fetchLyricsLrclib, fetchLyricsAi } from '@/lib/lyrics/lrclib';
import { platforms } from '@/lib/music/platforms';
import type { Track } from '@/lib/music/songlink';
import type { LyricsState } from '@/components/lyrics/LyricsPicker';

/* Lyrics state machine + LRCLIB/AI race.

   Two providers run in parallel from t=0:
     - LRCLIB (the "authoritative" path — community-maintained DB,
       plus a side route through NetEase/QQ lyrics endpoints when
       we know the track's platform id)
     - AI (LLM with web search, the fallback for cold-tail songs)

   LRCLIB wins any authoritative hit and aborts the AI request to save
   tokens. On LRCLIB miss we await the already-in-flight AI fetch —
   no second network call, just observation. Special sentinel
   `ai-miss` from LRCLIB short-circuits to not-found (used when
   LRCLIB's AI fallback already failed). */

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
    const { title, artist, platform, sourceUrl } = track;
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

    const lrclibP = fetchLyricsLrclib(
      title,
      artist,
      lrclibCtrl.signal,
      neteaseId,
      qqMid,
    ).catch((err) => {
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
          setState({ kind: 'found', lines: first.lines, source: 'lrclib' });
          return;
        }
        if (first.source === 'ai' && first.lines && first.lines.length > 0) {
          aiCtrl.abort();
          setState({ kind: 'found', lines: first.lines, source: 'ai' });
          return;
        }
        if (first.source === 'ai-miss') {
          aiCtrl.abort();
          setState({ kind: 'not-found' });
          return;
        }
      }

      setState({ kind: 'ai-searching' });
      const second = await aiP;
      if (ctrl.signal.aborted) return;
      if (second && second.lines && second.lines.length > 0) {
        setState({ kind: 'found', lines: second.lines, source: 'ai' });
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
