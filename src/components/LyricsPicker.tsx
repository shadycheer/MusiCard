import styles from './LyricsPicker.module.css';

export type LyricsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ai-searching' }
  | { kind: 'found'; lines: string[]; source: 'lrclib' | 'ai' }
  | { kind: 'not-found'; message?: string };

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
}: Props) {
  if (state.kind === 'idle') return null;

  const isLoading = state.kind === 'loading';
  const isAiSearching = state.kind === 'ai-searching';
  const isManualMode = state.kind === 'not-found';
  const aiSourced = state.kind === 'found' && state.source === 'ai';
  const manualTip =
    state.kind === 'not-found' && state.message
      ? state.message
      : '找不到歌词，可手动粘贴';

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

      {isManualMode && (
        <>
          <div className={styles.tip}>{manualTip}</div>
          <textarea
            className={styles.textarea}
            value={manualText}
            onChange={(e) => onManualTextChange(e.target.value)}
            placeholder="把歌词粘进来，自动按行分割"
          />
        </>
      )}

      {!isLoading && !isAiSearching && lines.length > 0 && (
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
                  <svg
                    className={styles.badge}
                    viewBox="0 0 16 16"
                    aria-hidden
                  >
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <span className={styles.badgePlaceholder} aria-hidden />
                )}
                <span className={styles.text}>{line}</span>
              </li>
            );
          })}
        </ul>
      )}

      {!isLoading &&
        !isAiSearching &&
        lines.length === 0 &&
        !isManualMode && <div className={styles.empty}>暂无歌词</div>}
    </div>
  );
}
