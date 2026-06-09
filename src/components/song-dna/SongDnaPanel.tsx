'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { SongDnaState } from '@/lib/song-dna/types';
import type { DnaHelixPhase } from './DnaHelix';
import SongDnaDoneBadge from './SongDnaDoneBadge';
import styles from './SongDnaPanel.module.css';

const DnaHelix = dynamic(() => import('./DnaHelix'), { ssr: false });

/* Helix stays at full size for all three phases (drift → spinner →
   checkmark). The button click triggers the loading request after a
   short delay so the morph drift→spinner has time to read. */
export const HERO_LAUNCH_DELAY_MS = 380;
/* Helix height during life — no shrink between phases, the helix is
   the main visual until the badge migrates to the header. 180px is
   a tight box for the new compact spinner (radius 1.45 ≈ 80px). */
export const HELIX_HEIGHT_PX = 180;

export type { SongDnaState };

type Props = {
  state: SongDnaState;
  onRequest: (refresh?: boolean) => void;
  /** Parent-owned migration stage. The panel reads this to know when
   *  to fade particles, show the helix-anchored SVG, and collapse the
   *  stage to make room for the article. */
  badgeStage: 'none' | 'helix-large' | 'migrating' | 'header-docked';
  /** Ref to the helix-center anchor element. Parent uses it to measure
   *  the start position for the migrating badge animation. The anchor
   *  is always mounted (zero size when no SVG inside) so the ref is
   *  stable for measurement. */
  helixAnchorRef?: React.RefObject<HTMLDivElement | null>;
};

export default function SongDnaPanel({
  state,
  onRequest,
  badgeStage,
  helixAnchorRef,
}: Props) {
  const [armed, setArmed] = useState(false);

  /* Reset armed when state returns to idle (parent clears the panel
     for a fresh track / aborts a stream). */
  useEffect(() => {
    if (state.kind === 'idle') setArmed(false);
  }, [state.kind]);

  if (state.kind === 'empty') {
    return (
      <div className={styles.empty}>
        <p>暂无可信资料。可以稍后重试，或换一首相对主流的歌。</p>
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

  /* Phase mapping:
     - idle, button not yet clicked → freeform drift (hero state)
     - idle, button just clicked → spinner morph begins (before parent
       has even kicked off the request)
     - loading (incl. refresh) → spinner
     - found → checkmark */
  const helixPhase: DnaHelixPhase =
    state.kind === 'idle' && !armed
      ? 'drift'
      : state.kind === 'found'
        ? 'checkmark'
        : 'spinner';

  /* Particles cross-fade out the moment a badge appears anywhere —
     they would otherwise compete visually with the SVG check. */
  const helixOpacity = badgeStage === 'none' ? 1 : 0;

  /* Container only collapses after the migrating badge has DOCKED.
     Collapsing during 'migrating' would cause the article to slide
     up under the moving badge — visually distracting. By holding the
     helix open through the migration, the badge animates over a
     stationary layout, then the helix collapses cleanly afterward. */
  const helixHeight = badgeStage === 'header-docked' ? 0 : HELIX_HEIGHT_PX;

  const articleText =
    state.kind === 'loading'
      ? state.streamedContent ?? ''
      : state.kind === 'found'
        ? state.payload.content
        : '';
  const hasArticle = articleText.length > 0;

  return (
    <div className={styles.stage}>
      <div
        className={styles.helixStage}
        style={{ height: helixHeight }}
      >
        <div className={styles.helixCanvasLayer} style={{ opacity: helixOpacity }}>
          <DnaHelix phase={helixPhase} />
        </div>

        {state.kind === 'idle' && (
          <button
            type="button"
            className={`${styles.heroAction} ${armed ? styles.heroActionGone : ''}`}
            disabled={armed}
            onClick={() => {
              setArmed(true);
              window.setTimeout(() => onRequest(false), HERO_LAUNCH_DELAY_MS);
            }}
          >
            开启 SONG-DNA
          </button>
        )}

        {/* Anchor is always mounted — gives the parent a stable rect
            to measure the migrating badge's start position from. */}
        <div
          className={styles.helixBadgeAnchor}
          ref={helixAnchorRef}
          aria-hidden
        >
          {badgeStage === 'helix-large' && <SongDnaDoneBadge size="large" />}
        </div>
      </div>

      {hasArticle && (
        <article className={styles.article}>
          <Markdown>{articleText}</Markdown>
        </article>
      )}
    </div>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      components={{
        h1: ({ children }) => <h2 className={styles.mdH2}>{children}</h2>,
        h2: ({ children }) => <h2 className={styles.mdH2}>{children}</h2>,
        h3: ({ children }) => <h3 className={styles.mdH3}>{children}</h3>,
        p: ({ children }) => <p className={styles.mdP}>{children}</p>,
        ul: ({ children }) => <ul className={styles.mdList}>{children}</ul>,
        ol: ({ children }) => <ol className={styles.mdList}>{children}</ol>,
        li: ({ children }) => <li className={styles.mdLi}>{children}</li>,
        a: ({ href, children }) => (
          <a
            className={styles.mdLink}
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className={styles.mdStrong}>{children}</strong>
        ),
        em: ({ children }) => <em className={styles.mdEm}>{children}</em>,
        hr: () => <hr className={styles.mdHr} />,
        code: ({ children }) => (
          <code className={styles.mdCode}>{children}</code>
        ),
        blockquote: ({ children }) => (
          <blockquote className={styles.mdQuote}>{children}</blockquote>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

export function formatCacheTime(iso: string): string {
  try {
    const d = new Date(iso);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return iso.slice(0, 10);
  }
}
