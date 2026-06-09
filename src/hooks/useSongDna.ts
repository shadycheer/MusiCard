import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { streamSongDna } from '@/lib/song-dna/client';
import type {
  SongDnaLoadingPhase,
  SongDnaState,
} from '@/lib/song-dna/types';
import type { Track } from '@/lib/music/songlink';

/* The whole Song DNA UX: SSE stream, state machine, and the badge
   migration animation timing.

   It's one hook (not two) because the badge stage is a pure function
   of the stream's derived state — `hasContent` flips, the helix grows
   a check; `isCachedHit` short-circuits straight to the docked
   header slot. Splitting them would force every consumer to wire the
   same two derived booleans into a second hook by hand. */

export type BadgeStage = 'none' | 'helix-large' | 'migrating' | 'header-docked';

export type MigrationCoords = {
  from: { x: number; y: number };
  to: { x: number; y: number };
};

const HELIX_LARGE_DELAY_MS = 450;
const MIGRATE_DELAY_MS = 650;

export function useSongDna(track: Track | null) {
  const [state, setState] = useState<SongDnaState>({ kind: 'idle' });
  const [badgeStage, setBadgeStage] = useState<BadgeStage>('none');
  const [migrationCoords, setMigrationCoords] = useState<MigrationCoords | null>(null);
  const helixAnchorRef = useRef<HTMLDivElement>(null);
  const headerBadgeRef = useRef<HTMLSpanElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* Track changes reset the stream + clear the panel. The badge-stage
     effect below picks up the `hasContent → false` transition and
     resets its own state, so we don't need to touch badge here. */
  useEffect(() => {
    abortRef.current?.abort();
    setState({ kind: 'idle' });
  }, [track]);

  const hasContent = useMemo(() => {
    if (state.kind === 'found') return true;
    if (
      state.kind === 'loading' &&
      (state.streamedContent ?? '').length > 0
    )
      return true;
    return false;
  }, [state]);

  const isCachedHit = state.kind === 'found' && state.cached === true;

  /* Badge stage machine:
     - no content yet → none (helix is in drift/spinner phase)
     - cache hit → jump straight to header-docked (no migration animation,
       since the result was instant and the celebratory flight would
       feel staged)
     - fresh AI result → schedule helix-large at +450ms, measure rects
       and start migration at +650ms. The consumer's <div onAnimationEnd>
       finishes the transition by calling setBadgeStage('header-docked'). */
  useEffect(() => {
    if (!hasContent) {
      setBadgeStage('none');
      setMigrationCoords(null);
      return;
    }
    if (isCachedHit) {
      setBadgeStage('header-docked');
      setMigrationCoords(null);
      return;
    }
    const tHelix = window.setTimeout(
      () => setBadgeStage('helix-large'),
      HELIX_LARGE_DELAY_MS,
    );
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
    }, MIGRATE_DELAY_MS);
    return () => {
      window.clearTimeout(tHelix);
      window.clearTimeout(tMigrate);
    };
  }, [hasContent, isCachedHit]);

  const request = useCallback(
    async (refresh = false) => {
      if (!track) return;

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setState({
        kind: 'loading',
        phase: refresh ? 'refreshing' : 'reading',
        currentAction: refresh ? '正在重新检索…' : '正在读取这首歌的资料…',
        streamedContent: '',
      });

      const params = new URLSearchParams({
        title: track.title,
        artist: track.artist,
        platform: track.platform,
        sourceUrl: track.sourceUrl,
        ...(refresh ? { refresh: 'true' } : {}),
      });

      try {
        let receivedTerminal = false;
        await streamSongDna(
          `/api/song-dna?${params.toString()}`,
          (event) => {
            if (event.kind === 'status') {
              setState((s) =>
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
              setState((s) =>
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
                setState({
                  kind: 'found',
                  payload: event.payload,
                  cached: event.cached,
                  cachedAt: event.cachedAt,
                });
              } else {
                setState({ kind: 'empty' });
              }
            } else if (event.kind === 'error') {
              receivedTerminal = true;
              setState({ kind: 'error', message: event.message });
            }
          },
          ctrl.signal,
        );
        if (!receivedTerminal && !ctrl.signal.aborted) {
          setState({
            kind: 'error',
            message: '查询超时或流意外终止',
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : '请求失败',
        });
      }
    },
    [track],
  );

  return {
    state,
    request,
    hasContent,
    isCachedHit,
    badgeStage,
    setBadgeStage,
    migrationCoords,
    helixAnchorRef,
    headerBadgeRef,
  };
}

function phaseToText(phase: SongDnaLoadingPhase, detail?: string): string {
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
