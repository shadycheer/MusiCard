'use client';

import styles from './SongDNAPanel.module.css';

export type SongCredits = {
  lyrics?: string | null;
  composition?: string | null;
  arrangement?: string | null;
  production?: string | null;
};

export type SongDNAState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; story: string; credits?: SongCredits; sources?: string[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

type Props = {
  state: SongDNAState;
  onRequest: () => void;
};

const CREDIT_LABELS: Record<keyof SongCredits, string> = {
  lyrics: '作词',
  composition: '作曲',
  arrangement: '编曲',
  production: '制作',
};

export default function SongDNAPanel({ state, onRequest }: Props) {
  if (state.kind === 'idle') {
    return (
      <div className={styles.idle}>
        <p className={styles.idleHint}>
          点这里，让 AI 帮你查这首歌的作词作曲、灵感来源、制作过程。
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
    const creditEntries = (Object.keys(CREDIT_LABELS) as Array<keyof SongCredits>)
      .map((key) => ({ key, value: state.credits?.[key] }))
      .filter((c): c is { key: keyof SongCredits; value: string } => !!c.value);

    return (
      <div className={styles.essay}>
        {creditEntries.length > 0 && (
          <dl className={styles.credits}>
            {creditEntries.map(({ key, value }) => (
              <div key={key} className={styles.creditRow}>
                <dt className={styles.creditLabel}>{CREDIT_LABELS[key]}</dt>
                <dd className={styles.creditValue}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className={styles.story}>{state.story}</p>
        {state.sources && state.sources.length > 0 && (
          <p className={styles.sources}>参考：{state.sources.join(' · ')}</p>
        )}
        <button
          type="button"
          className={styles.regenerate}
          onClick={onRequest}
        >
          重新查询
        </button>
      </div>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div className={styles.empty}>
        <p>这首歌的可靠资料还不够完整 — 我宁愿留白，也不想编故事给你。</p>
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
