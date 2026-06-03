import { useCallback, useEffect, useRef, useState } from 'react';
import { parseMusicUrl } from '../lib/musicUrl';
import { fetchTrack, type Track } from '../lib/songlink';

export type FetchState =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'loading' }
  | { kind: 'success'; track: Track }
  | { kind: 'error'; message: string };

export function useTrackInfo(input: string): { state: FetchState; refetch: () => void } {
  const [state, setState] = useState<FetchState>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const run = useCallback((value: string) => {
    abortRef.current?.abort();

    if (!value.trim()) {
      setState({ kind: 'idle' });
      return;
    }

    const parsed = parseMusicUrl(value);
    if (parsed.kind === 'invalid') {
      setState({ kind: 'invalid', message: '请粘贴 Spotify 或 Apple Music 单曲链接' });
      return;
    }
    if (parsed.kind === 'non-track') {
      setState({ kind: 'invalid', message: '目前只支持单曲链接' });
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setState({ kind: 'loading' });

    fetchTrack(parsed.canonicalUrl, parsed.platform, ctrl.signal)
      .then((track) => {
        if (!ctrl.signal.aborted) setState({ kind: 'success', track });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : '拿不到歌曲信息',
        });
      });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => run(input), 250);
    return () => clearTimeout(t);
  }, [input, run]);

  const refetch = useCallback(() => run(inputRef.current), [run]);

  return { state, refetch };
}
