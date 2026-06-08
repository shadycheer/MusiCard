'use client';

import styles from './SongDnaDoneBadge.module.css';

type Props = {
  /** 'large' rides at the helix center the moment SONG-DNA lands.
   *  Its visual (bright check stroke on a green disc with a soft
   *  glow halo) is designed to match the particle-rendered checkmark
   *  underneath, so the cross-fade reads as "the particles solidify"
   *  rather than "a different element appears".
   *
   *  'small' is the docked badge in the panel header — a proper
   *  completion badge with a dark check stroke on a green disc,
   *  high-contrast at chip size. */
  size?: 'large' | 'small';
};

/* Both render-sites set the same viewTransitionName so the browser
   interpolates position when state flips inside startViewTransition. */
export default function SongDnaDoneBadge({ size = 'small' }: Props) {
  const isLarge = size === 'large';
  return (
    <span
      className={isLarge ? styles.badgeLarge : styles.badgeSmall}
      style={{ viewTransitionName: 'songdna-done-badge' }}
      aria-label="SONG-DNA 已就绪"
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="#1ED760" />
        <path
          d="M7.2 12.2 10.6 15.6 16.8 9.2"
          stroke={isLarge ? '#ffffff' : '#0a0a0a'}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
