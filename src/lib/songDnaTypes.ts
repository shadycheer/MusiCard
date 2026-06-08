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
