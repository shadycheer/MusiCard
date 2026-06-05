'use client';

import { useState, useRef, useEffect } from 'react';
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
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <span className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.badge}
        aria-label={`查看来源 ${number}`}
        onClick={() => setOpen((o) => !o)}
      >
        <sup>⁽{toSuperscript(number)}⁾</sup>
      </button>
      {open && (
        <span className={styles.popover} role="dialog">
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
            打开来源 ↗
          </a>
        </span>
      )}
    </span>
  );
}
