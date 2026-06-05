'use client';

import { useMemo } from 'react';
import CitationRef from './CitationRef';
import { buildCitationRegistry } from '@/lib/songDnaClient';
import type {
  Citation,
  Fact,
  Paragraph,
  SongDnaFound,
  SongDnaLoadingPhase,
} from '@/lib/songDnaTypes';
import styles from './SongDNAPanel.module.css';

export type SongDNAState =
  | { kind: 'idle' }
  | {
      kind: 'loading';
      phase: SongDnaLoadingPhase | 'reading' | 'refreshing';
      currentAction: string;
    }
  | {
      kind: 'found';
      payload: SongDnaFound;
      cached: boolean;
      cachedAt?: string;
    }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

type Props = {
  state: SongDNAState;
  onRequest: (refresh?: boolean) => void;
};

const FACT_LABELS = {
  album: '专辑',
  releaseDate: '发行',
  label: '唱片公司',
  duration: '时长',
  lyrics: '作词',
  composition: '作曲',
  arrangement: '编曲',
  production: '制作',
  studio: '录音棚',
  musicians: '乐手',
  engineers: '工程师',
} as const;

export default function SongDNAPanel({ state, onRequest }: Props) {
  if (state.kind === 'idle') {
    return (
      <div className={styles.idle}>
        <p className={styles.idleHint}>
          点这里，让 AI 联网帮你查这首歌的作词作曲、灵感来源、制作过程、影响传承。
        </p>
        <button
          type="button"
          className={styles.action}
          onClick={() => onRequest(false)}
        >
          阅读这首歌
        </button>
      </div>
    );
  }

  if (state.kind === 'loading') {
    return (
      <div className={styles.loading}>
        <span className={styles.loadingPulse} aria-hidden>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </span>
        <span
          key={state.currentAction}
          className={styles.loadingText}
          title={state.currentAction}
        >
          {truncate(state.currentAction, 60)}
        </span>
      </div>
    );
  }

  if (state.kind === 'empty') {
    return (
      <div className={styles.empty}>
        <p>这首歌目前找不到足够可信的公开资料 — 我宁愿留白，也不想凭空给你写。</p>
        <button
          type="button"
          className={styles.retryGhost}
          onClick={() => onRequest(true)}
        >
          再试一次
        </button>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className={styles.error}>
        <p>{state.message}</p>
        <button
          type="button"
          className={styles.retryGhost}
          onClick={() => onRequest(true)}
        >
          重新检索
        </button>
      </div>
    );
  }

  return (
    <FoundView
      payload={state.payload}
      cached={state.cached}
      cachedAt={state.cachedAt}
      onRefresh={() => onRequest(true)}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────

function FoundView({
  payload,
  cached,
  cachedAt,
  onRefresh,
}: {
  payload: SongDnaFound;
  cached: boolean;
  cachedAt?: string;
  onRefresh: () => void;
}) {
  const registry = useMemo(() => buildCitationRegistry(payload), [payload]);

  return (
    <div className={styles.found}>
      {cached && (
        <div className={styles.cacheMeta}>
          <span className={styles.cacheTag}>资料·已存档</span>
          {cachedAt && (
            <span className={styles.cacheTime}>
              · 缓存于 {relativeTime(cachedAt)}
            </span>
          )}
          <button
            type="button"
            className={styles.refreshButton}
            onClick={onRefresh}
          >
            ↻ 重新检索
          </button>
        </div>
      )}

      {hasIdentity(payload) && (
        <Section number="〇一" title="身份信息">
          <FactList
            data={payload.identity!}
            keys={['album', 'releaseDate', 'label', 'duration'] as const}
            numberOf={registry.numberOf}
          />
        </Section>
      )}

      {hasCredits(payload) && (
        <Section number="〇二" title="创作团队">
          <FactList
            data={payload.credits!}
            keys={
              [
                'lyrics',
                'composition',
                'arrangement',
                'production',
                'studio',
                'musicians',
                'engineers',
              ] as const
            }
            numberOf={registry.numberOf}
          />
        </Section>
      )}

      {hasMaking(payload) && (
        <Section number="〇三" title="创作过程">
          {payload.making!.inspiration && (
            <ParagraphBlock
              label="① 灵感起源"
              paragraph={payload.making!.inspiration}
              numberOf={registry.numberOf}
            />
          )}
          {payload.making!.writing && (
            <ParagraphBlock
              label="② 写作过程·艺人当时处境"
              paragraph={payload.making!.writing}
              numberOf={registry.numberOf}
            />
          )}
          {payload.making!.recording && (
            <ParagraphBlock
              label="③ 录制现场·关键决策·轶事"
              paragraph={payload.making!.recording}
              numberOf={registry.numberOf}
            />
          )}
        </Section>
      )}

      {hasLegacy(payload) && (
        <Section number="〇四" title="影响与传承">
          {payload.legacy!.commercial && (
            <ParagraphBlock
              label="商业表现"
              paragraph={payload.legacy!.commercial}
              numberOf={registry.numberOf}
            />
          )}
          {payload.legacy!.awards && (
            <FactRow
              label="获奖"
              value={
                <ul className={styles.bulletList}>
                  {payload.legacy!.awards.value.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              }
              citations={payload.legacy!.awards.citations}
              numberOf={registry.numberOf}
            />
          )}
          {payload.legacy!.covers && (
            <FactRow
              label="被翻唱"
              value={
                <ul className={styles.bulletList}>
                  {payload.legacy!.covers.value.map((c, i) => (
                    <li key={i}>
                      {c.artist}
                      {c.year ? ` (${c.year})` : ''}
                      {c.note ? ` — ${c.note}` : ''}
                    </li>
                  ))}
                </ul>
              }
              citations={payload.legacy!.covers.citations}
              numberOf={registry.numberOf}
            />
          )}
          {payload.legacy!.mediaUse && (
            <FactRow
              label="影视游戏使用"
              value={
                <ul className={styles.bulletList}>
                  {payload.legacy!.mediaUse.value.map((m, i) => (
                    <li key={i}>
                      《{m.title}》
                      {m.year ? ` (${m.year})` : ''} — {m.medium}
                    </li>
                  ))}
                </ul>
              }
              citations={payload.legacy!.mediaUse.citations}
              numberOf={registry.numberOf}
            />
          )}
          {payload.legacy!.impact && (
            <ParagraphBlock
              label="文化影响"
              paragraph={payload.legacy!.impact}
              numberOf={registry.numberOf}
            />
          )}
        </Section>
      )}

      {!cached && (
        <button
          type="button"
          className={styles.refreshGhost}
          onClick={onRefresh}
        >
          ↻ 重新检索
        </button>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionKicker}>{number}</span>
        <h3 className={styles.sectionTitle}>{title}</h3>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

type FactKey = keyof typeof FACT_LABELS;

function FactList<T extends { [K in FactKey]?: Fact<unknown> }>({
  data,
  keys,
  numberOf,
}: {
  data: T;
  keys: readonly FactKey[];
  numberOf: (url: string) => number;
}) {
  return (
    <dl className={styles.factList}>
      {keys.map((k) => {
        const fact = data[k];
        if (!fact) return null;
        return (
          <div key={k} className={styles.factRow}>
            <dt className={styles.factLabel}>{FACT_LABELS[k]}</dt>
            <dd className={styles.factValue}>
              <FactValue value={fact.value} />
              <Citations citations={fact.citations} numberOf={numberOf} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function FactRow({
  label,
  value,
  citations,
  numberOf,
}: {
  label: string;
  value: React.ReactNode;
  citations: Citation[];
  numberOf: (url: string) => number;
}) {
  return (
    <dl className={styles.factList}>
      <div className={styles.factRow}>
        <dt className={styles.factLabel}>{label}</dt>
        <dd className={styles.factValue}>
          {value}
          <Citations citations={citations} numberOf={numberOf} />
        </dd>
      </div>
    </dl>
  );
}

function FactValue({ value }: { value: unknown }) {
  if (typeof value === 'string') return <>{value}</>;
  if (Array.isArray(value)) return <>{(value as string[]).join('、')}</>;
  if (value && typeof value === 'object') {
    const v = value as { mixing?: string; mastering?: string; recording?: string };
    const parts: string[] = [];
    if (v.recording) parts.push(`录音 ${v.recording}`);
    if (v.mixing) parts.push(`混音 ${v.mixing}`);
    if (v.mastering) parts.push(`母带 ${v.mastering}`);
    return <>{parts.join(' · ')}</>;
  }
  return null;
}

function ParagraphBlock({
  label,
  paragraph,
  numberOf,
}: {
  label: string;
  paragraph: Paragraph;
  numberOf: (url: string) => number;
}) {
  return (
    <div className={styles.paragraphBlock}>
      <h4 className={styles.paragraphLabel}>{label}</h4>
      <p className={styles.paragraphText}>{paragraph.text}</p>
      {paragraph.image && (
        <figure className={styles.figure}>
          <img
            src={paragraph.image.url}
            alt={paragraph.image.caption ?? ''}
            onError={(e) => {
              const fig = (e.currentTarget as HTMLImageElement).closest('figure');
              if (fig) (fig as HTMLElement).style.display = 'none';
            }}
          />
          {paragraph.image.caption && (
            <figcaption>{paragraph.image.caption}</figcaption>
          )}
          {paragraph.image.sourceUrl && (
            <a
              href={paragraph.image.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.figureSource}
            >
              ↗ 图源
            </a>
          )}
        </figure>
      )}
      <div className={styles.paragraphSources}>
        <span className={styles.paragraphSourcesLabel}>来源</span>
        <Citations citations={paragraph.citations} numberOf={numberOf} />
      </div>
    </div>
  );
}

function Citations({
  citations,
  numberOf,
}: {
  citations: Citation[];
  numberOf: (url: string) => number;
}) {
  // The model sometimes attaches the same URL multiple times to the same
  // fact/paragraph — dedupe so we render each source's superscript once.
  const seen = new Set<string>();
  const unique = citations.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
  return (
    <>
      {unique.map((c) => (
        <CitationRef key={c.url} number={numberOf(c.url)} citation={c} />
      ))}
    </>
  );
}

// ─── Existence helpers ────────────────────────────────────────────────────

function hasIdentity(p: SongDnaFound): boolean {
  return !!p.identity && Object.values(p.identity).some((v) => v != null);
}
function hasCredits(p: SongDnaFound): boolean {
  return !!p.credits && Object.values(p.credits).some((v) => v != null);
}
function hasMaking(p: SongDnaFound): boolean {
  return !!p.making && Object.values(p.making).some((v) => v != null);
}
function hasLegacy(p: SongDnaFound): boolean {
  return !!p.legacy && Object.values(p.legacy).some((v) => v != null);
}

// ─── Utilities ────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} 个月前`;
  return `${Math.floor(mo / 12)} 年前`;
}
