'use client';

import { useMemo } from 'react';
import CitationRef from './CitationRef';
import { buildCitationRegistry } from '@/lib/songDnaClient';
import type {
  ArticleSection,
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
        <p className={styles.idleHint}>AI 帮你考据这首歌</p>
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
        <p>暂无可信资料</p>
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
          {cachedAt && (
            <span className={styles.cacheTime}>
              缓存于 {relativeTime(cachedAt)}
            </span>
          )}
          <button
            type="button"
            className={styles.refreshButton}
            onClick={onRefresh}
          >
            重新检索
          </button>
        </div>
      )}

      {payload.article ? (
        <ArticleView article={payload.article} numberOf={registry.numberOf} />
      ) : (
        <>
          {hasIdentity(payload) && (
            <Section title="曲目">
              <FactList
                data={payload.identity!}
                keys={['album', 'releaseDate', 'label', 'duration'] as const}
                numberOf={registry.numberOf}
              />
            </Section>
          )}

          {hasCredits(payload) && (
            <Section title="幕后">
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
            <Section title="故事">
              {payload.making!.inspiration && (
                <ParagraphBlock
                  label="灵感"
                  paragraph={payload.making!.inspiration}
                  numberOf={registry.numberOf}
                />
              )}
              {payload.making!.writing && (
                <ParagraphBlock
                  label="写作"
                  paragraph={payload.making!.writing}
                  numberOf={registry.numberOf}
                />
              )}
              {payload.making!.recording && (
                <ParagraphBlock
                  label="录制"
                  paragraph={payload.making!.recording}
                  numberOf={registry.numberOf}
                />
              )}
            </Section>
          )}

          {hasLegacy(payload) && (
            <Section title="回响">
              {payload.legacy!.commercial && (
                <ParagraphBlock
                  label="成绩"
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
                  label="翻唱"
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
                  label="影视使用"
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
                  label="影响"
                  paragraph={payload.legacy!.impact}
                  numberOf={registry.numberOf}
                />
              )}
            </Section>
          )}
        </>
      )}

      {registry.registry.length > 0 && (
        <ReferencesList citations={registry.registry} />
      )}

      {!cached && (
        <button
          type="button"
          className={styles.refreshGhost}
          onClick={onRefresh}
        >
          重新检索
        </button>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function ArticleView({
  article,
  numberOf,
}: {
  article: NonNullable<SongDnaFound['article']>;
  numberOf: (url: string) => number;
}) {
  return (
    <article className={styles.article}>
      <header className={styles.articleHead}>
        <h3 className={styles.articleTitle}>{article.headline}</h3>
        <p className={styles.articleLead}>
          {article.lead.text}
          <Citations citations={article.lead.citations} numberOf={numberOf} />
        </p>
      </header>

      {article.keyFacts && article.keyFacts.value.length > 0 && (
        <div className={styles.keyFacts}>
          <ul>
            {article.keyFacts.value.map((fact, i) => (
              <li key={i}>
                {fact}
                {i === article.keyFacts!.value.length - 1 && (
                  <Citations
                    citations={article.keyFacts!.citations}
                    numberOf={numberOf}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {article.sections.map((section, i) => (
        <ArticleSectionBlock
          key={`${section.title}-${i}`}
          section={section}
          numberOf={numberOf}
        />
      ))}

      {article.takeaway && (
        <div className={styles.takeaway}>
          <p>
            {article.takeaway.text}
            <Citations
              citations={article.takeaway.citations}
              numberOf={numberOf}
            />
          </p>
        </div>
      )}
    </article>
  );
}

function ArticleSectionBlock({
  section,
  numberOf,
}: {
  section: ArticleSection;
  numberOf: (url: string) => number;
}) {
  return (
    <section className={styles.articleSection}>
      <h4 className={styles.articleSectionTitle}>{section.title}</h4>
      <p className={styles.paragraphText}>
        {section.body.text}
        <Citations citations={section.body.citations} numberOf={numberOf} />
      </p>
      {section.body.image && (
        <figure className={styles.figure}>
          <img
            src={section.body.image.url}
            alt={section.body.image.caption ?? ''}
            onError={(e) => {
              const fig = (e.currentTarget as HTMLImageElement).closest('figure');
              if (fig) (fig as HTMLElement).style.display = 'none';
            }}
          />
          {section.body.image.caption && (
            <figcaption>{section.body.image.caption}</figcaption>
          )}
          {section.body.image.sourceUrl && (
            <a
              href={section.body.image.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.figureSource}
            >
              图源
            </a>
          )}
        </figure>
      )}
    </section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
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
      <p className={styles.paragraphText}>
        {paragraph.text}
        <Citations citations={paragraph.citations} numberOf={numberOf} />
      </p>
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
              图源
            </a>
          )}
        </figure>
      )}
    </div>
  );
}

function ReferencesList({ citations }: { citations: Citation[] }) {
  return (
    <footer className={styles.references}>
      <h4 className={styles.referencesTitle}>参考资料</h4>
      <ol className={styles.referencesList}>
        {citations.map((c, i) => (
          <li key={c.url} className={styles.referenceItem}>
            <span className={styles.referenceIndex}>{i + 1}</span>
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.referenceLink}
            >
              {c.title || hostnameOf(c.url)}
            </a>
          </li>
        ))}
      </ol>
    </footer>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
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

function truncate(s: string | null | undefined, max: number): string {
  const text = s ?? '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
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
