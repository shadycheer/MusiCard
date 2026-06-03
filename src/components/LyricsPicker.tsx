import { useMemo } from 'react';
import styles from './LyricsPicker.module.css';
import { parseLyrics } from '../lib/lrclib';

export type LyricsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'found'; lines: string[] }
  | { kind: 'not-found' };

type Props = {
  state: LyricsState;
  manualText: string;
  onManualTextChange: (text: string) => void;
  selected: string[];
  onToggle: (line: string) => void;
  maxSelected: number;
};

export default function LyricsPicker({
  state,
  manualText,
  onManualTextChange,
  selected,
  onToggle,
  maxSelected,
}: Props) {
  const manualLines = useMemo(
    () => (manualText ? parseLyrics(manualText) : []),
    [manualText],
  );

  if (state.kind === 'idle') return null;

  const isLoading = state.kind === 'loading';
  const fromLrclib = state.kind === 'found' ? state.lines : [];
  const lines = fromLrclib.length > 0 ? fromLrclib : manualLines;
  const isManualMode = state.kind === 'not-found' && fromLrclib.length === 0;

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
          <div className={styles.tip}>LRCLIB 没收录这首歌,可以从 Spotify / Apple Music app 复制歌词粘到这:</div>
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
            const selectedIdx = selected.indexOf(line);
            const isSelected = selectedIdx >= 0;
            return (
              <li
                key={`${i}-${line}`}
                className={`${styles.line} ${isSelected ? styles.lineSelected : ''}`}
                onClick={() => onToggle(line)}
              >
                {isSelected ? (
                  <span className={styles.badge}>{selectedIdx + 1}</span>
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
