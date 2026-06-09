/* Song DNA is a stream of markdown prose — a short editorial essay about
   the song, with the model deciding its own structure. We no longer ask
   for a fixed JSON schema; the model produces a 600-1100 char Chinese
   markdown piece with inline citation markers and a 参考资料 section at
   the end. References are inline in the markdown. */

export type SongDnaFound = {
  hasData: true;
  content: string; // full markdown body, including 参考资料 section
};

export type SongDnaPayload = { hasData: false } | SongDnaFound;

export type SongDnaLoadingPhase =
  | 'started'
  | 'searching'
  | 'analyzing'
  | 'synthesizing'
  | 'reading'
  | 'refreshing';

export type SongDnaStreamEvent =
  | { kind: 'status'; phase: SongDnaLoadingPhase; detail?: string }
  | { kind: 'chunk'; text: string }
  | { kind: 'final'; payload: SongDnaPayload; cached: boolean; cachedAt?: string }
  | { kind: 'error'; message: string };

/* UI-side state machine the hook + panel both consume. Distinct from
   the API events above — `loading` carries the human-readable
   `currentAction` derived from the latest status phase, and `found`
   embeds the cache metadata so the docked-badge UI can branch on
   fresh-vs-cached at render time. */
export type SongDnaFound_State = {
  payload: SongDnaFound;
  cached: boolean;
  cachedAt?: string;
};

export type SongDnaState =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      phase: SongDnaLoadingPhase;
      currentAction: string;
      streamedContent?: string;
    }
  | ({ kind: 'found' } & SongDnaFound_State)
  | { kind: 'empty' }
  | { kind: 'error'; message: string };
