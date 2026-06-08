'use client';

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import type { Citation } from '@/lib/songDnaTypes';
import styles from './CitationRef.module.css';

type Props = {
  number: number;
  citation: Citation;
};

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
function toSuperscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERSCRIPTS[Number(d)] ?? d)
    .join('');
}

export default function CitationRef({ number, citation }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);

  const updatePosition = () => {
    const button = buttonRef.current;
    if (!button || typeof window === 'undefined') return;

    const rect = button.getBoundingClientRect();
    const margin = 16;
    const width = Math.min(320, window.innerWidth - margin * 2);
    const estimatedHeight = 260;
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - estimatedHeight - 8;
    const top =
      belowTop + estimatedHeight <= window.innerHeight - margin
        ? belowTop
        : Math.max(margin, aboveTop);
    const centeredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(
      Math.max(margin, centeredLeft),
      window.innerWidth - width - margin,
    );

    setPos({ top, left, width });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updatePosition();

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open]);

  const popover =
    open && pos && typeof document !== 'undefined'
      ? createPortal(
          <span
            className={styles.popover}
            role="dialog"
            ref={popoverRef}
            style={pos}
          >
            {citation.title && (
              <span className={styles.title}>{citation.title}</span>
            )}
            {citation.excerpt && (
              <span className={styles.excerpt}>「{citation.excerpt}」</span>
            )}
            <a
              href={citation.url}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.link}
            >
              打开来源
            </a>
          </span>,
          document.body,
        )
      : null;

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.badge}
        ref={buttonRef}
        aria-label={`查看来源 ${number}`}
        onClick={() => setOpen((o) => !o)}
      >
        <sup>⁽{toSuperscript(number)}⁾</sup>
      </button>
      {popover}
    </span>
  );
}
