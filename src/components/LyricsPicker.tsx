import styles from './LyricsPicker.module.css';

export type LyricsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; lines: string[] }
  | { kind: 'not-found' };

type Props = {
  state: LyricsState;
  lines: string[];
  manualText: string;
  onManualTextChange: (text: string) => void;
  selected: number[];
  onToggle: (idx: number) => void;
  maxSelected: number;
};

export default function LyricsPicker({
  state,
  lines,
  manualText,
  onManualTextChange,
  selected,
  onToggle,
  maxSelected,
}: Props) {
  if (state.kind === 'idle') return null;

  const isLoading = state.kind === 'loading';
  const isManualMode = state.kind === 'not-found';

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>歌词</span>
        <span>
          已选 {selected.length}/{maxSelected}
        </span>
      </div>

      {isLoading && <div className={styles.loading}>加载歌词中…</div>}

      {isManualMode && (
        <>
          <div className={styles.tip}>
            LRCLIB 没收录这首歌,可以从 Spotify / Apple Music app 复制歌词粘到这:
          </div>
          <textarea
            className={styles.textarea}
            value={manualText}
            onChange={(e) => onManualTextChange(e.target.value)}
            placeholder="把歌词粘进来,自动按行分割"
          />
        </>
      )}

      {!isLoading && lines.length > 0 && (
        <ul className={styles.list}>
          {lines.map((line, i) => {
            const order = selected.indexOf(i);
            const isSelected = order >= 0;
            return (
              <li
                key={i}
                className={`${styles.line} ${isSelected ? styles.lineSelected : ''}`}
                onClick={() => onToggle(i)}
              >
                {isSelected ? (
                  <span className={styles.badge}>{order + 1}</span>
                ) : (
                  <span className={styles.badgePlaceholder} />
                )}
                <span className={styles.text}>{line}</span>
              </li>
            );
          })}
        </ul>
      )}

      {!isLoading && lines.length === 0 && !isManualMode && (
        <div className={styles.empty}>暂无歌词</div>
      )}
    </div>
  );
}
