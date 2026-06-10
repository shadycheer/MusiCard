import styles from './LyricsPicker.module.css';

export type LyricsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ai-searching' }
  | { kind: 'found'; lines: string[]; source: 'lrclib' | 'ai' }
  | { kind: 'not-found' };

type Props = {
  state: LyricsState;
  lines: string[];
  selected: number[];
  onToggle: (idx: number) => void;
  maxSelected: number;
};

export default function LyricsPicker({
  state,
  lines,
  selected,
  onToggle,
}: Props) {
  if (state.kind === 'idle') return null;

  const isLoading = state.kind === 'loading';
  const isAiSearching = state.kind === 'ai-searching';
  const aiSourced = state.kind === 'found' && state.source === 'ai';

  return (
    <div className={styles.wrap}>
      {isLoading && <div className={styles.loading}>查找歌词中…</div>}

      {isAiSearching && (
        <div className={styles.loading}>AI 在帮你找歌词…</div>
      )}

      {aiSourced && (
        <div className={styles.aiBadge}>
          <span className={styles.aiBadgeTag}>AI</span>
          <span className={styles.aiBadgeText}>由 AI 找回，请核对</span>
        </div>
      )}

      {!isLoading && !isAiSearching && lines.length > 0 && (
        <ul className={styles.list}>
          {lines.map((line, i) => {
            const order = selected.indexOf(i);
            const isSelected = order >= 0;
            return (
              <li key={i}>
                <button
                  type="button"
                  className={`${styles.line} ${isSelected ? styles.lineSelected : ''}`}
                  onClick={() => onToggle(i)}
                  aria-pressed={isSelected}
                >
                  <svg
                    className={styles.checkbox}
                    viewBox="0 0 18 18"
                    aria-hidden
                  >
                    <circle
                      cx="9"
                      cy="9"
                      r="7.5"
                      fill={isSelected ? 'currentColor' : 'transparent'}
                      stroke="currentColor"
                      strokeWidth="1.4"
                    />
                    {isSelected && (
                      <path
                        d="M5.5 9.2 7.8 11.4 12.5 6.6"
                        stroke="#0a0a0a"
                        strokeWidth="1.8"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}
                  </svg>
                  <span className={styles.text}>{line}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!isLoading && !isAiSearching && lines.length === 0 && (
        <div className={styles.empty}>暂无歌词</div>
      )}
    </div>
  );
}
