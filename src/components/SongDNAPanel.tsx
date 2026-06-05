'use client';

import styles from './SongDNAPanel.module.css';

export type SongDNAState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; text: string; sources?: string[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

type Props = {
  state: SongDNAState;
  onRequest: () => void;
};

export default function SongDNAPanel({ state, onRequest }: Props) {
  if (state.kind === 'idle') {
    return (
      <div className={styles.idle}>
        <p className={styles.idleHint}>
          有些歌的故事比它的旋律更长。点这里，让 AI 替你查一查这首歌的来历。
        </p>
        <button type="button" className={styles.action} onClick={onRequest}>
          阅读这首歌
        </button>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingDot} />
        <span className={styles.loadingText}>正在翻找这首歌的资料…</span>
      </div>
    );
  }

  if (state.kind === 'found') {
    const first = state.text.charAt(0);
    const rest = state.text.slice(1);
    return (
      <div className={styles.essay}>
        <p className={styles.essayBody}>
          <span className={styles.essayDropCap}>{first}</span>
          {rest}
        </p>
        {state.sources && state.sources.length > 0 && (
          <p className={styles.sources}>
            参考：{state.sources.join(' · ')}
          </p>
        )}
        <button
          type="button"
          className={styles.regenerate}
          onClick={onRequest}
          aria-label="重新获取"
        >
          重新阅读
        </button>
      </div>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div className={styles.empty}>
        <p>这首歌的故事还在等待被讲述。</p>
        <button type="button" className={styles.retryGhost} onClick={onRequest}>
          再试一次
        </button>
      </div>
    );
  }

  return (
    <div className={styles.error}>
      <p>{state.message}</p>
      <button type="button" className={styles.retryGhost} onClick={onRequest}>
        再试一次
      </button>
    </div>
  );
}
