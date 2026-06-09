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

/* White check on green disc — matches the additive particle render
   (which can only do bright colors) so the cross-fade stays seamless
   end-to-end, and is the standard "completion badge" visual (iCloud,
   Material Design, etc.). Same design at both sizes — the migration
   from helix center to header dock is purely scale + translate, no
   color swap mid-flight. */
export default function SongDnaDoneBadge({ size = 'small' }: Props) {
  const isLarge = size === 'large';
  return (
    <span
      className={isLarge ? styles.badgeLarge : styles.badgeSmall}
      aria-label="SONG-DNA 已就绪"
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="#1ED760" />
        <path
          d="M7.2 12.2 10.6 15.6 16.8 9.2"
          stroke="#ffffff"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
